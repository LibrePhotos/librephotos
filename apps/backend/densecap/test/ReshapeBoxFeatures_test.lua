require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

require 'ReshapeBoxFeatures'
require 'densecap.modules.MakeBoxes'
local gradcheck = require 'gradcheck'

local tests = {}
local tester = torch.Tester()


function tests.testBackwardNumeric()
  local N, k, D, H, W = 2, 3, 4, 5, 6
  local mod = nn.ReshapeBoxFeatures(k)
  local x = torch.randn(N, k * D, H, W)
  local y = mod:forward(x)
  local dy = torch.randn(#y)
  local dx = mod:backward(x, dy)
  
  local function f(xx)
    return nn.ReshapeBoxFeatures(k):forward(xx):clone()
  end
  
  local dx_num = gradcheck.numeric_gradient(f, x, dy)
  tester:assertle(gradcheck.relative_error(dx, dx_num), 1e-8)
end


-- Make sure that the striding between MakeBoxes and ReshapeBoxFeatures
-- is consistent
function tests.consistencyCheck()
  local N, k, D = 2, 2, 5
  local H, W = 4, 3

  local anchors = torch.Tensor(2, k)
  anchors[{{}, 1}] = torch.Tensor{10, 20}
  anchors[{{}, 2}] = torch.Tensor{20, 10}
  
  local make_boxes = nn.MakeBoxes(1, 1, 2, 2, anchors)
  local reshape_features = nn.ReshapeBoxFeatures(k)

  local transforms = torch.zeros(N, 4 * k, H, W)
  local features = torch.zeros(N, D * k, H, W)

  -- We will permute the transforms and features for a single
  -- box; after making boxes and reshaping the features, the
  -- same row of each result should be permuted.
  transforms[{2, {1, 4}, 3, 2}] = torch.Tensor{10, 10, 0, 0}
  features[{2, {1, D}, 3, 2}]:fill(100)
  
  local boxes = make_boxes:forward(transforms)
  local features_out = reshape_features:forward(features)

  tester:assertTensorEq(boxes[{2, 8}], torch.Tensor{103, 205, 10, 20}, 0)
  tester:assertTensorEq(features_out[{2, 8}], torch.Tensor(D):fill(100), 0)
end


tester:add(tests)
tester:run()