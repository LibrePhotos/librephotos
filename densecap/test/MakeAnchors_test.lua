require 'torch'
require 'cutorch'
require 'nn'

require 'ReshapeBoxFeatures'

require 'densecap.modules.ApplyBoxTransform'
require 'densecap.modules.MakeAnchors'
require 'densecap.modules.MakeBoxes'

local tests = {}
local tester = torch.Tester()


-- Make sure that MakeAnchors + ReshapeBoxFeatures + ApplyBoxTransform
-- computes the same thing as MakeBoxes
local function consistencyFactory(dtype)
  return function()
    local x0, y0, sx, sy = 1, 2, 3, 4
    local N, H, W = 2, 3, 5
    local k = 7

    local anchors = torch.randn(2, k):abs():type(dtype)
    local transforms = torch.randn(N, 4 * k, H, W):type(dtype)

    local make_boxes = nn.MakeBoxes(x0, y0, sx, sy, anchors):type(dtype)
    local boxes1 = make_boxes:forward(transforms)

    local net = nn.Sequential()
    local concat = nn.ConcatTable()
    local s = nn.Sequential()
    s:add(nn.MakeAnchors(x0, y0, sx, sy, anchors))
    s:add(nn.ReshapeBoxFeatures(k))
    concat:add(s)
    concat:add(nn.ReshapeBoxFeatures(k))
    net:add(concat)
    net:add(nn.ApplyBoxTransform())
    net:type(dtype)

    local boxes2 = net:forward(transforms)

    tester:assertTensorEq(boxes1, boxes2, 1e-6)
  end
end

tests.floatConsistencyTest = consistencyFactory('torch.FloatTensor')
tests.doubleConsistencyTest = consistencyFactory('torch.DoubleTensor')
tests.cudaConsistencyTest = consistencyFactory('torch.CudaTensor')



tester:add(tests)
tester:run()
