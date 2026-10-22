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
//
// Boxes are fractions of the image (0...1) with the origin at the TOP left,
// the way React Native lays things out (Vision's own origin is bottom left).
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
  }

  // MARK: - Recognition

  static func recognize(uri: String, options: RecognizeOptions) throws -> [String: Any] {
    let url = fileUrl(uri)
    guard let image = UIImage(contentsOfFile: url.path), let cgImage = image.cgImage else {
      throw ImageOpenException(uri)
    }

    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = options.languageCorrection
    request.recognitionLanguages = languages(for: request, wanted: options.languages)
    if #available(iOS 16.0, *) {
      request.automaticallyDetectsLanguage = options.autoDetectLanguage
    }

    // Full resolution, with the photo's own orientation, so boxes match the image as shown.
    let handler = VNImageRequestHandler(
      cgImage: cgImage,
      orientation: CGImagePropertyOrientation(image.imageOrientation),
      options: [:]
    )
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
        "words": words,
        "alternatives": candidates.dropFirst().map { $0.string },
      ])
    }

    return [
      "width": Int(image.size.width * image.scale),
      "height": Int(image.size.height * image.scale),
      "lines": lines,
    ]
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

  static func fileUrl(_ uri: String) -> URL {
    if let url = URL(string: uri), url.scheme != nil {
      return url
    }
    return URL(fileURLWithPath: uri)
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
