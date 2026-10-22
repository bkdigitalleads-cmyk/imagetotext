Pod::Spec.new do |s|
  s.name           = 'VisionOcr'
  s.version        = '1.0.0'
  s.summary        = 'On-device text recognition and PDF page rendering for Image to Text'
  s.description    = 'Reads printed text and handwriting from an image on the device, and renders PDF pages to images. No network.'
  s.author         = 'Brian Kershner'
  s.homepage       = 'https://bkdigitalleads-cmyk.github.io/imagetotext/'
  s.license        = { :type => 'Proprietary' }
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'Vision', 'PDFKit', 'UIKit'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
