local filenames = {
  'test/BoxIoU_test.lua',
  'test/BoxSampler_test.lua',
  'test/MakeBoxes_test.lua',
  'test/MakeAnchors_test.lua',
  'test/ReshapeBoxFeatures_test.lua',
  'test/OurSmoothL1Criterion_test.lua',
  'test/BoxSamplerHelper_test.lua',
  'test/nms_test.lua',
  'test/clip_boxes_test.lua',
  'test/LogisticCriterion_test.lua',
  'test/BatchBilinearSamplerBHWD_test.lua',
  'test/BoxToAffine_test.lua',
  'test/ApplyBoxTransform_test.lua',
  'test/InvertBoxTransform_test.lua',
  'test/BilinearRoiPooling_test.lua',
  'test/language_model_test.lua',
}

for i = 1, #filenames do
  local filename = filenames[i]
  print(string.format('Running %s', filename))
  dofile(filename)
end
