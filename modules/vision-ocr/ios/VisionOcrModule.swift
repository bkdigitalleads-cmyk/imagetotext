import AVFoundation
import CoreImage
import ExpoModulesCore
import PDFKit
import UIKit
import Vision

// On-device text recognition for Image to Text. Nothing here touches the
// network: Vision runs on the phone, and PDF pages are drawn on the phone.
//
//   recognize(uri, options)   -> { width, height, lines: [{ text, confidence, box, words, alternatives }] }
//   supportedLanguages()      -> ["en-US", ...]
//   renderPdf(uri, options)   -> { pageCount, pages: [{ uri, width, height }] }
//   documentBounds(uri)       -> { found, confidence, method, corners: [tlx, tly, trx, try, brx, bry, blx, bly], width, height }
//   flatten(uri, options)     -> { uri, width, height }  (perspective-corrected page)
//   recognizeRegions(uri, options) -> { elapsedMs, results: [{ text, confidence, words, alternatives }] }
//   sharpness(uri, options)   -> variance of the Laplacian on a small grayscale copy (higher is sharper)
//   focusAt(x, y, hold)       -> focus and expose the back camera at a point, then back to continuous
//
// Corners are pixels of the image as shown (orientation applied), origin at
// the top left.
//
// Boxes are fractions of the image (0...1) with the origin at the TOP left,
// the way React Native lays things out. Vision's own boxes have the origin
// at the BOTTOM left; every box leaving this module goes through `box(_:)`
// or the same math (y = 1 - y - height): line boxes, word boxes, second-pass
// words and page corners. Vision's result order is not reading order; the
// TypeScript side sorts lines (paragraphs.ts, orderLines).
// Word ranges are UTF-16 offsets into the line text, so they index a JS string.

struct RecognizeOptions: Record {
  @Field var languages: [String] = ["en-US"]
  @Field var autoDetectLanguage: Bool = true
  @Field var languageCorrection: Bool = true
  /// How many candidates to read per line. The first is the text; the rest
  /// come back as `alternatives`, which the app uses to spot unsure words.
  @Field var candidates: Int = 3
}

struct RenderPdfOptions: Record {
  @Field var maxPages: Int = 50
  /// Long edge of each rendered page, in pixels.
  @Field var longEdge: Double = 2400
}

struct FlattenOptions: Record {
  /// Eight numbers: top-left x, y, top-right x, y, bottom-right x, y, bottom-left x, y, in pixels.
  @Field var corners: [Double] = []
}

struct RegionsOptions: Record {
  /// Four numbers per region: x, y, width, height as fractions of the image, origin top left.
  @Field var boxes: [Double] = []
  @Field var languages: [String] = ["en-US"]
  @Field var autoDetectLanguage: Bool = true
  @Field var languageCorrection: Bool = true
  @Field var candidates: Int = 3
  /// How much each crop is enlarged before it is read again.
  @Field var scale: Double = 2
}

struct SharpnessOptions: Record {
  /// Optional region: x, y, width, height as fractions of the image, origin top left.
  @Field var region: [Double] = []
  /// Long edge of the grayscale copy the measure runs on, in pixels.
  @Field var size: Double = 512
}

final class FlattenException: GenericException<String> {
  override var reason: String { "Could not straighten the page in \(param)" }
}

final class ImageOpenException: GenericException<String> {
  override var reason: String { "Could not open the image at \(param)" }
}

final class PdfOpenException: GenericException<String> {
  override var reason: String { "Could not open the PDF at \(param)" }
}

final class PdfLockedException: GenericException<String> {
  override var reason: String { "The PDF at \(param) has a password" }
}

public class VisionOcrModule: Module {
  public func definition() -> ModuleDefinition {
    Name("VisionOcr")

    // Async functions run off the main thread, so Vision can work synchronously here.
    AsyncFunction("recognize") { (uri: String, options: RecognizeOptions) -> [String: Any] in
      return try VisionOcrModule.recognize(uri: uri, options: options)
    }

    AsyncFunction("supportedLanguages") { () -> [String] in
      let request = VNRecognizeTextRequest()
      request.recognitionLevel = .accurate
      return (try? request.supportedRecognitionLanguages()) ?? ["en-US"]
    }

    AsyncFunction("renderPdf") { (uri: String, options: RenderPdfOptions) -> [String: Any] in
      return try VisionOcrModule.renderPdf(uri: uri, options: options)
    }

    AsyncFunction("documentBounds") { (uri: String) -> [String: Any] in
      return try VisionOcrModule.documentBounds(uri: uri)
    }

    AsyncFunction("flatten") { (uri: String, options: FlattenOptions) -> [String: Any] in
      return try VisionOcrModule.flatten(uri: uri, options: options)
    }

    AsyncFunction("recognizeRegions") { (uri: String, options: RegionsOptions) -> [String: Any] in
      return try VisionOcrModule.recognizeRegions(uri: uri, options: options)
    }

    AsyncFunction("sharpness") { (uri: String, options: SharpnessOptions) -> Double in
      return try VisionOcrModule.sharpness(uri: uri, options: options)
    }

    AsyncFunction("focusAt") { (x: Double, y: Double, hold: Double) -> Bool in
      return VisionOcrModule.focusAt(x: x, y: y, hold: hold)
    }

    // UITextChecker is UIKit, so it runs on the main queue. A page is a few
    // hundred words; this takes milliseconds.
    AsyncFunction("unknownWords") { (texts: [String], language: String) -> [[Int]] in
      return MainActor.assumeIsolated { VisionOcrModule.unknownWords(texts: texts, language: language) }
    }.runOnQueue(.main)

    // TestFlight and development builds carry a sandbox receipt; the App
    // Store build does not. Gates the hidden test tools in Settings.
    Function("isTestBuild") { () -> Bool in
      return Bundle.main.appStoreReceiptURL?.lastPathComponent == "sandboxReceipt"
    }
  }

  // MARK: - Dictionary check

  /**
   For each text, the positions of its whitespace-separated words that the
   system dictionary does not know. Only words of three or more letters are
   checked (no digits or inner punctuation), and words with a capital first
   letter are skipped unless all capitals (names are often missing from the
   dictionary). The same rule as `checkable` in src/accuracy.ts.
   */
  @MainActor
  static func unknownWords(texts: [String], language: String) -> [[Int]] {
    let checker = UITextChecker()
    let available = UITextChecker.availableLanguages
    let lang = available.first(where: { $0 == language })
      ?? available.first(where: { $0.hasPrefix(String(language.prefix(2))) })
      ?? "en_US"
    return texts.map { text in
      var out: [Int] = []
      let tokens = text.split(whereSeparator: { $0.isWhitespace })
      for (i, token) in tokens.enumerated() {
        let word = String(token).trimmingCharacters(in: CharacterSet.letters.inverted)
        guard word.count >= 3, word.allSatisfy({ $0.isLetter }) else { continue }
        if let first = word.first, first.isUppercase, word != word.uppercased() { continue }
        let length = (word as NSString).length
        let miss = checker.rangeOfMisspelledWord(
          in: word, range: NSRange(location: 0, length: length), startingAt: 0, wrap: false, language: lang)
        if miss.location != NSNotFound { out.append(i) }
      }
      return out
    }
  }

  // MARK: - Recognition

  static func recognize(uri: String, options: RecognizeOptions) throws -> [String: Any] {
    // Upright pixels first, so Vision's coordinates mean the same thing for
    // every image: a flattened page, a crop, an untouched photo from the
    // library (often stored sideways with an orientation tag), a PDF page.
    let cgImage = try uprightCGImage(uri: uri)

    let request = textRequest(
      languages: options.languages,
      autoDetect: options.autoDetectLanguage,
      correction: options.languageCorrection
    )
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    try handler.perform([request])

    let wantCandidates = min(10, max(1, options.candidates))
    var lines: [[String: Any]] = []
    for observation in request.results ?? [] {
      let candidates = observation.topCandidates(wantCandidates)
      guard let best = candidates.first else { continue }
      let text = best.string
      if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { continue }

      var words: [[String: Any]] = []
      text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .byWords) { _, range, _, _ in
        guard let rect = try? best.boundingBox(for: range) else { return }
        let ns = NSRange(range, in: text)
        words.append([
          "start": ns.location,
          "end": ns.location + ns.length,
          "box": box(rect.boundingBox),
        ])
      }

      lines.append([
        "text": text,
        "confidence": Double(best.confidence),
        "box": box(observation.boundingBox),
        "corners": corners(observation),
        "words": words,
        "alternatives": candidates.dropFirst().map { $0.string },
      ])
    }

    return [
      "width": cgImage.width,
      "height": cgImage.height,
      "lines": lines,
    ]
  }

  static func textRequest(languages wanted: [String], autoDetect: Bool, correction: Bool) -> VNRecognizeTextRequest {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = correction
    request.recognitionLanguages = languages(for: request, wanted: wanted)
    if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = autoDetect
    }
    return request
  }

  /// The languages asked for that this iPhone supports, in the order asked, with en-US always in.
  static func languages(for request: VNRecognizeTextRequest, wanted: [String]) -> [String] {
    var list = wanted.filter { !$0.isEmpty }
    if !list.contains("en-US") {
      list.append("en-US")
    }
    if let supported = try? request.supportedRecognitionLanguages() {
      let usable = list.filter { supported.contains($0) }
      if !usable.isEmpty {
        return usable
      }
    }
    return ["en-US"]
  }

  /// Vision rect (origin bottom left) to a top-left box.
  static func box(_ r: CGRect) -> [String: Double] {
    return [
      "x": Double(r.minX),
      "y": Double(1 - r.maxY),
      "width": Double(r.width),
      "height": Double(r.height),
    ]
  }

  /// A line's own four corners (it can sit at an angle): top-left, top-right,
  /// bottom-right, bottom-left, as fractions with the origin at the TOP left.
  static func corners(_ o: VNRectangleObservation) -> [Double] {
    let flip = { (p: CGPoint) -> [Double] in [Double(p.x), 1 - Double(p.y)] }
    return flip(o.topLeft) + flip(o.topRight) + flip(o.bottomRight) + flip(o.bottomLeft)
  }

  static func fileUrl(_ uri: String) -> URL {
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: uri)
  }

  // MARK: - Shared image loading

  /// One context for every Core Image render; it is safe to use from several threads.
  nonisolated(unsafe) static let ciContext = CIContext(options: [.cacheIntermediates: false])

  /// The image as shown (orientation applied) as a CIImage with its origin at 0, 0.
  static func orientedImage(uri: String) throws -> CIImage {
    let url = fileUrl(uri)
    guard let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
      throw ImageOpenException(uri)
    }
    let oriented = CIImage(cgImage: cgImage).oriented(CGImagePropertyOrientation(image.imageOrientation))
    let e = oriented.extent
    return oriented.transformed(by: CGAffineTransform(translationX: -e.minX, y: -e.minY))
  }

  /// The image as shown, as pixels that are already upright. A photo stored
  /// sideways with an orientation tag is turned for real, so Vision never
  /// has to interpret the tag and every path shares one coordinate system.
  static func uprightCGImage(uri: String) throws -> CGImage {
    let url = fileUrl(uri)
    guard let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
      throw ImageOpenException(uri)
    }
    if image.imageOrientation == .up {
      return cgImage
    }
    let oriented = CIImage(cgImage: cgImage).oriented(CGImagePropertyOrientation(image.imageOrientation))
    guard let upright = ciContext.createCGImage(oriented, from: oriented.extent.integral) else {
      throw ImageOpenException(uri)
    }
    return upright
  }

  static func writeJpeg(_ cgImage: CGImage, folder: String, quality: CGFloat) throws -> URL {
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent(folder, isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let file = dir.appendingPathComponent("\(UUID().uuidString).jpg")
    guard let data = UIImage(cgImage: cgImage).jpegData(compressionQuality: quality) else {
      throw FlattenException(file.path)
    }
    try data.write(to: file)
    return file
  }

  // MARK: - Page detection

  /// The page in a photo: document segmentation first, rectangle detection
  /// when that finds nothing. Corners are pixels of the image as shown.
  static func documentBounds(uri: String) throws -> [String: Any] {
    let cgImage = try uprightCGImage(uri: uri)
    let width = Double(cgImage.width)
    let height = Double(cgImage.height)
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])

    var found: VNRectangleObservation?
    var method = "none"

    let segmentation = VNDetectDocumentSegmentationRequest()
    if (try? handler.perform([segmentation])) != nil, let best = segmentation.results?.first {
      found = best
      method = "segmentation"
    }

    if found == nil {
      let rectangles = VNDetectRectanglesRequest()
      rectangles.maximumObservations = 1
      rectangles.minimumConfidence = 0.5
      rectangles.minimumSize = 0.25
      rectangles.minimumAspectRatio = 0.3
      rectangles.maximumAspectRatio = 1.0
      rectangles.quadratureTolerance = 30
      if (try? handler.perform([rectangles])) != nil, let best = rectangles.results?.first {
        found = best
        method = "rectangle"
      }
    }

    guard let page = found else {
      return ["found": false, "confidence": 0.0, "method": method, "corners": [Double](), "width": width, "height": height]
    }
    // Vision's points are fractions with the origin at the bottom left.
    let px = { (p: CGPoint) -> [Double] in [Double(p.x) * width, (1 - Double(p.y)) * height] }
    return [
      "found": true,
      "confidence": Double(page.confidence),
      "method": method,
      "corners": px(page.topLeft) + px(page.topRight) + px(page.bottomRight) + px(page.bottomLeft),
      "width": width,
      "height": height,
    ]
  }

  // MARK: - Flattening

  /// The page cut out along its four corners and squared up, at full resolution.
  static func flatten(uri: String, options: FlattenOptions) throws -> [String: Any] {
    let c = options.corners
    guard c.count == 8 else { throw FlattenException(uri) }
    let image = try orientedImage(uri: uri)
    let h = Double(image.extent.height)
    // Core Image's origin is the bottom left, so flip y.
    let point = { (i: Int) -> CIVector in CIVector(x: CGFloat(c[i]), y: CGFloat(h - c[i + 1])) }
    guard let filter = CIFilter(name: "CIPerspectiveCorrection") else { throw FlattenException(uri) }
    filter.setValue(image, forKey: kCIInputImageKey)
    filter.setValue(point(0), forKey: "inputTopLeft")
    filter.setValue(point(2), forKey: "inputTopRight")
    filter.setValue(point(4), forKey: "inputBottomRight")
    filter.setValue(point(6), forKey: "inputBottomLeft")
    guard let output = filter.outputImage,
          let cgImage = ciContext.createCGImage(output, from: output.extent.integral) else {
      throw FlattenException(uri)
    }
    let file = try writeJpeg(cgImage, folder: "vision-ocr-flat", quality: 0.95)
    return ["uri": file.absoluteString, "width": cgImage.width, "height": cgImage.height]
  }

  // MARK: - Second pass on small or unsure lines

  /// Reads each region again from a padded crop enlarged `scale` times, all
  /// at once on several threads. For each region, the reading whose line
  /// sits closest to the region's middle; words come back in page fractions.
  static func recognizeRegions(uri: String, options: RegionsOptions) throws -> [String: Any] {
    let started = CFAbsoluteTimeGetCurrent()
    let image = try orientedImage(uri: uri)
    let W = Double(image.extent.width)
    let H = Double(image.extent.height)
    let boxes = options.boxes
    let count = boxes.count / 4
    let wantCandidates = min(10, max(1, options.candidates))
    let scale = max(1, min(4, options.scale))
    let collected = RegionResults(count: count)

    DispatchQueue.concurrentPerform(iterations: count) { i in
      autoreleasepool {
        let bx = boxes[i * 4] * W
        let by = boxes[i * 4 + 1] * H
        let bw = boxes[i * 4 + 2] * W
        let bh = boxes[i * 4 + 3] * H
        guard bw > 1, bh > 1 else { return }
        // Some room around the line, more sideways than up and down so the
        // lines above and below stay out of the crop.
        let padX = bh * 0.6
        let padY = bh * 0.35
        let rx = max(0, bx - padX)
        let ry = max(0, by - padY)
        let rw = min(W, bx + bw + padX) - rx
        let rh = min(H, by + bh + padY) - ry
        guard rw > 1, rh > 1 else { return }
        let ciRect = CGRect(x: rx, y: H - ry - rh, width: rw, height: rh)
        var crop = image.cropped(to: ciRect)
        crop = crop.transformed(by: CGAffineTransform(translationX: -ciRect.minX, y: -ciRect.minY))
        if let lanczos = CIFilter(name: "CILanczosScaleTransform") {
          lanczos.setValue(crop, forKey: kCIInputImageKey)
          lanczos.setValue(scale, forKey: kCIInputScaleKey)
          lanczos.setValue(1.0, forKey: kCIInputAspectRatioKey)
          if let out = lanczos.outputImage { crop = out }
        }
        guard let cg = ciContext.createCGImage(crop, from: crop.extent.integral) else { return }

        let request = textRequest(
          languages: options.languages,
          autoDetect: options.autoDetectLanguage,
          correction: options.languageCorrection
        )
        let handler = VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:])
        guard (try? handler.perform([request])) != nil, let observations = request.results, !observations.isEmpty else { return }

        // The line we came for is the one nearest the crop's middle.
        let target = (by + bh / 2 - ry) / rh
        let pick = observations.min { a, b in
          abs((1 - Double(a.boundingBox.midY)) - target) < abs((1 - Double(b.boundingBox.midY)) - target)
        }
        guard let observation = pick else { return }
        let candidates = observation.topCandidates(wantCandidates)
        guard let best = candidates.first else { return }
        let text = best.string

        var words: [[String: Any]] = []
        text.enumerateSubstrings(in: text.startIndex..<text.endIndex, options: .byWords) { _, range, _, _ in
          guard let rect = try? best.boundingBox(for: range) else { return }
          let r = rect.boundingBox
          let ns = NSRange(range, in: text)
          words.append([
            "start": ns.location,
            "end": ns.location + ns.length,
            "box": [
              "x": (rx + Double(r.minX) * rw) / W,
              "y": (ry + (1 - Double(r.maxY)) * rh) / H,
              "width": Double(r.width) * rw / W,
              "height": Double(r.height) * rh / H,
            ],
          ])
        }

        collected.set(i, [
          "text": text,
          "confidence": Double(best.confidence),
          "words": words,
          "alternatives": candidates.dropFirst().map { $0.string },
        ])
      }
    }

    return ["elapsedMs": (CFAbsoluteTimeGetCurrent() - started) * 1000, "results": collected.all()]
  }

  // MARK: - Sharpness

  /**
   * How sharp a photo (or a region of it) is: the variance of the Laplacian
   * on a grayscale copy about `size` pixels on its long edge. Text in focus
   * has crisp edges and scores high; a soft photo scores low. Cheap: no Vision.
   */
  static func sharpness(uri: String, options: SharpnessOptions) throws -> Double {
    let image = try orientedImage(uri: uri)
    let W = image.extent.width
    let H = image.extent.height
    var region = image.extent
    let r = options.region
    if r.count == 4 {
      region = CGRect(
        x: CGFloat(r[0]) * W,
        y: CGFloat(1 - r[1] - r[3]) * H,
        width: CGFloat(r[2]) * W,
        height: CGFloat(r[3]) * H
      ).intersection(image.extent)
    }
    guard !region.isNull, region.width > 8, region.height > 8 else { return 0 }
    var small = image.cropped(to: region).transformed(by: CGAffineTransform(translationX: -region.minX, y: -region.minY))
    let scale = min(1, CGFloat(max(64, options.size)) / max(region.width, region.height))
    if scale < 1, let lanczos = CIFilter(name: "CILanczosScaleTransform") {
      lanczos.setValue(small, forKey: kCIInputImageKey)
      lanczos.setValue(scale, forKey: kCIInputScaleKey)
      lanczos.setValue(1.0, forKey: kCIInputAspectRatioKey)
      if let out = lanczos.outputImage { small = out }
    }
    let w = Int(small.extent.width.rounded(.down))
    let h = Int(small.extent.height.rounded(.down))
    guard w > 2, h > 2 else { return 0 }
    var pixels = [UInt8](repeating: 0, count: w * h)
    ciContext.render(
      small,
      toBitmap: &pixels,
      rowBytes: w,
      bounds: CGRect(x: small.extent.minX, y: small.extent.minY, width: CGFloat(w), height: CGFloat(h)),
      format: .L8,
      colorSpace: CGColorSpaceCreateDeviceGray()
    )
    var sum = 0.0
    var sumSq = 0.0
    var n = 0.0
    for y in 1..<(h - 1) {
      for x in 1..<(w - 1) {
        let i = y * w + x
        let v = Double(pixels[i - w]) + Double(pixels[i + w]) + Double(pixels[i - 1]) + Double(pixels[i + 1]) - 4 * Double(pixels[i])
        sum += v
        sumSq += v * v
        n += 1
      }
    }
    guard n > 0 else { return 0 }
    let mean = sum / n
    return sumSq / n - mean * mean
  }

  // MARK: - Tap to focus

  /// Each tap gets a ticket; only the latest tap's timer hands focus back to continuous.
  static let focusTicket = FocusTicket()

  /**
   * Focus and expose the back camera at a point, held for `hold` seconds,
   * then back to continuous autofocus and exposure. The point is in the
   * camera's own coordinates: (0, 0) top left and (1, 1) bottom right with
   * the phone turned landscape, home side right. It is the same physical
   * camera expo-camera shows (the back wide-angle one), so the preview
   * focuses where it was tapped.
   */
  static func focusAt(x: Double, y: Double, hold: Double) -> Bool {
    guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else { return false }
    let point = CGPoint(x: min(1, max(0, x)), y: min(1, max(0, y)))
    do {
      try device.lockForConfiguration()
      if device.isFocusPointOfInterestSupported, device.isFocusModeSupported(.autoFocus) {
        device.focusPointOfInterest = point
        device.focusMode = .autoFocus
      }
      if device.isExposurePointOfInterestSupported, device.isExposureModeSupported(.autoExpose) {
        device.exposurePointOfInterest = point
        device.exposureMode = .autoExpose
      }
      device.unlockForConfiguration()
    } catch {
      return false
    }
    let ticket = VisionOcrModule.focusTicket.next()
    DispatchQueue.main.asyncAfter(deadline: .now() + max(0.5, hold)) {
      guard VisionOcrModule.focusTicket.isLatest(ticket),
            let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
            (try? camera.lockForConfiguration()) != nil else { return }
      if camera.isFocusModeSupported(.continuousAutoFocus) {
        camera.focusMode = .continuousAutoFocus
      }
      if camera.isExposureModeSupported(.continuousAutoExposure) {
        camera.exposureMode = .continuousAutoExposure
      }
      camera.unlockForConfiguration()
    }
    return true
  }

  // MARK: - PDF pages

  static func renderPdf(uri: String, options: RenderPdfOptions) throws -> [String: Any] {
    guard let document = PDFDocument(url: fileUrl(uri)) else {
      throw PdfOpenException(uri)
    }
    if document.isLocked {
      throw PdfLockedException(uri)
    }

    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("vision-ocr-pdf", isDirectory: true)
    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    let stamp = UUID().uuidString
    let count = document.pageCount
    let limit = min(count, max(0, options.maxPages))
    var pages: [[String: Any]] = []

    for index in 0..<limit {
      try autoreleasepool {
        guard let page = document.page(at: index), let cgPage = page.pageRef else { return }
        let mediaBox = cgPage.getBoxRect(.mediaBox)
        let quarterTurned = abs(Int(cgPage.rotationAngle)) % 180 == 90
        // The page as it is meant to be read, after its own rotation.
        let pageSize = quarterTurned
          ? CGSize(width: mediaBox.height, height: mediaBox.width)
          : mediaBox.size
        guard pageSize.width > 0, pageSize.height > 0 else { return }

        let scale = CGFloat(max(200, options.longEdge)) / max(pageSize.width, pageSize.height)
        let size = CGSize(width: (pageSize.width * scale).rounded(), height: (pageSize.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let rendered = UIGraphicsImageRenderer(size: size, format: format).image { context in
          let cg = context.cgContext
          UIColor.white.setFill()
          cg.fill(CGRect(origin: .zero, size: size))
          // PDF space has its origin at the bottom left; flip, scale up, then
          // let the page's drawing transform apply its rotation. The target
          // rect is the page's own size, so that transform never rescales.
          cg.translateBy(x: 0, y: size.height)
          cg.scaleBy(x: scale, y: -scale)
          cg.concatenate(cgPage.getDrawingTransform(
            .mediaBox,
            rect: CGRect(origin: .zero, size: pageSize),
            rotate: 0,
            preserveAspectRatio: true
          ))
          cg.drawPDFPage(cgPage)
        }

        guard let data = rendered.jpegData(compressionQuality: 0.92) else { return }
        let file = dir.appendingPathComponent("\(stamp)-\(index + 1).jpg")
        try data.write(to: file)
        pages.append([
          "uri": file.absoluteString,
          "width": Int(size.width),
          "height": Int(size.height),
        ])
      }
    }

    return ["pageCount": count, "pages": pages]
  }
}

/// A counter behind a lock, for tap-to-focus timers.
final class FocusTicket: @unchecked Sendable {
  private var value = 0
  private let lock = NSLock()

  func next() -> Int {
    lock.lock()
    defer { lock.unlock() }
    value += 1
    return value
  }

  func isLatest(_ ticket: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    return ticket == value
  }
}

/// Results written from several threads at once, one slot per region, behind a lock.
final class RegionResults: @unchecked Sendable {
  private var items: [[String: Any]]
  private let lock = NSLock()

  init(count: Int) {
    items = [[String: Any]](
      repeating: ["text": "", "confidence": 0.0, "words": [[String: Any]](), "alternatives": [String]()],
      count: count
    )
  }

  func set(_ index: Int, _ value: [String: Any]) {
    lock.lock()
    items[index] = value
    lock.unlock()
  }

  func all() -> [[String: Any]] {
    lock.lock()
    defer { lock.unlock() }
    return items
  }
}

extension CGImagePropertyOrientation {
  init(_ orientation: UIImage.Orientation) {
    switch orientation {
    case .up: self = .up
    case .upMirrored: self = .upMirrored
    case .down: self = .down
    case .downMirrored: self = .downMirrored
    case .left: self = .left
    case .leftMirrored: self = .leftMirrored
    case .right: self = .right
    case .rightMirrored: self = .rightMirrored
    @unknown default: self = .up
    }
  }
}
