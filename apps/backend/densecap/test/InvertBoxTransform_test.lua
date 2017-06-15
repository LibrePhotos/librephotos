require 'torch'
require 'cutorch'

require 'densecap.modules.ApplyBoxTransform'
require 'densecap.modules.InvertBoxTransform'

local gradcheck = require 'gradcheck'


local tests = {}
local tester = torch.Tester()


-- Make sure that ApplyBoxTransform -> InvertBoxTransform computes the identity
local function applyInvertFactory(dtype, epsilon)
  return function()
    local B = 10
    local anchor_boxes = torch.randn(B, 4):type(dtype)
    anchor_boxes[{{}, {3, 4}}]:abs()
    local trans = torch.randn(B, 4):type(dtype)

    local apply = nn.ApplyBoxTransform():type(dtype)
    local invert = nn.InvertBoxTransform():type(dtype)

    local boxes = apply:forward{anchor_boxes, trans}
    local trans_alt = invert:forward{anchor_boxes, boxes}

    tester:assertTensorEq(trans, trans_alt, epsilon or 1e-4)
  end
end

tests.applyInvertFloatTest = applyInvertFactory('torch.FloatTensor')
tests.applyInvertDoubleTest = applyInvertFactory('torch.DoubleTensor', 1e-6)
tests.applyInvertCudaTest = applyInvertFactory('torch.CudaTensor')


-- Make sure that InvertBoxTransform -> ApplyBoxTransform computes the identity
local function invertApplyFactory(dtype, epsilon)
  return function()
    local B = 10
    local anchor_boxes = torch.randn(B, 4):type(dtype)
    anchor_boxes[{{}, {3, 4}}]:abs()
    local target_boxes = torch.randn(B, 4):type(dtype)
    target_boxes[{{}, {3, 4}}]:abs()

    local apply = nn.ApplyBoxTransform():type(dtype)
    local invert = nn.InvertBoxTransform():type(dtype)

    local trans = invert:forward{anchor_boxes, target_boxes}
    local boxes = apply:forward{anchor_boxes, trans}

    tester:assertTensorEq(boxes, target_boxes, epsilon or 1e-4)
  end
end

tests.invertApplyFloatTest = invertApplyFactory('torch.FloatTensor')
tests.invertApplyDoubleTest = invertApplyFactory('torch.DoubleTensor', 1e-6)
tests.invertApplyCudaTest = invertApplyFactory('torch.CudaTensor')


function tests.gradCheck()
  local B = 10
  local anchor_boxes = torch.randn(B, 4)
  anchor_boxes[{{}, {3, 4}}]:abs()
  local target_boxes = torch.randn(B, 4)
  target_boxes[{{}, {3, 4}}]:abs()

  local grad_output = torch.randn(B, 4)

  local mod = nn.InvertBoxTransform()
  mod:forward{anchor_boxes, target_boxes}
  local din = mod:backward({anchor_boxes, target_boxes}, grad_output)
  local grad_anchor_boxes, grad_target_boxes = unpack(din)
  
  local function f_anchor(x)
    return nn.InvertBoxTransform():forward{x, target_boxes}
  end
  
  local function f_target(x)
    return nn.InvertBoxTransform():forward{anchor_boxes, x}
  end
  
  local grad_anchor_boxes_num = gradcheck.numeric_gradient(f_anchor, anchor_boxes, grad_output)
  local grad_target_boxes_num = gradcheck.numeric_gradient(f_target, target_boxes, grad_output)

  local anchor_err = gradcheck.relative_error(grad_anchor_boxes, grad_anchor_boxes_num)
  local target_err = gradcheck.relative_error(grad_target_boxes, grad_target_boxes_num)
  tester:assertle(anchor_err, 1e-7)
  tester:assertle(target_err, 1e-7)
end

  
tester:add(tests)
tester:run()
