require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

local gradcheck = require 'gradcheck'
local utils = require 'utils'
require 'densecap.modules.BoxToAffine'

local tests = {}
local tester = torch.Tester()


function simpleTestFactory(dtype)
  return function()
    local B = 4
    local H, W = 20, 30
    local boxes = torch.randn(B, 4)
    boxes[1] = torch.Tensor{(W + 1) / 2, (H + 1) / 2, W, H} 
    boxes[2] = torch.Tensor{10, 12, 4, 5}
    boxes[3] = torch.Tensor{15, 17, 2, 3}
    boxes[4] = torch.Tensor{(W + 1) / 2, (H + 1) / 2, W / 2, H / 2}

    boxes = boxes:type(dtype)
    local mod = nn.BoxToAffine(H, W):setSize(H, W):type(dtype)
    local out = mod:forward(boxes)
    local expected_out = torch.Tensor(B, 2, 3):zero()

    expected_out[{1, 1}] = torch.Tensor{1, 0, 0}
    expected_out[{1, 2}] = torch.Tensor{0, 1, 0}    

    expected_out[{2, 1}] = torch.Tensor{1 / 4, 0, 3 / 19}
    expected_out[{2, 2}] = torch.Tensor{0, 2 / 15, -11 / 29}

    expected_out[{3, 1}] = torch.Tensor{3 / 20, 0, 13 / 19}
    expected_out[{3, 2}] = torch.Tensor{0, 1 / 15, -1 / 29}

    expected_out[{4, 1}] = torch.Tensor{0.5, 0,  0}
    expected_out[{4, 2}] = torch.Tensor{0,  0.5, 0}

    expected_out = expected_out:type(dtype)
    tester:assertTensorEq(out, expected_out, 1e-6)
  end
end

tests.floatSimpleTest = simpleTestFactory('torch.FloatTensor')
tests.doubleSimpleTest = simpleTestFactory('torch.DoubleTensor')
tests.cudaSimpleTest = simpleTestFactory('torch.CudaTensor')

function tests.numericGradientTest()
  local B = 20
  local H, W = 20, 30
  local boxes = torch.randn(B, 4)
  local mod = nn.BoxToAffine():setSize(H, W)
  local out = mod:forward(boxes)
  local dout = torch.randn(#out)
  local din = mod:backward(boxes, dout)

  local function f(xx)
    return nn.BoxToAffine():setSize(H, W):forward(xx)
  end
  local din_numeric = gradcheck.numeric_gradient(f, boxes, dout)
  
  tester:assertle(gradcheck.relative_error(din_numeric, din), 1e-6)
end


tester:add(tests)
tester:run()
