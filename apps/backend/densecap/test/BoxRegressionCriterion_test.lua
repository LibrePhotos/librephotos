require 'torch'

local gradcheck = require 'gradcheck'
require 'densecap.modules.BoxRegressionCriterion'

local tests = {}
local tester = torch.Tester()

function tests.gradCheck()
  local B = 10
  local w = 2.71
  local transforms = torch.randn(B, 4)
  local anchor_boxes = torch.randn(B, 4)
  anchor_boxes[{{}, {3, 4}}]:abs()
  local target_boxes = torch.randn(B, 4)
  target_boxes[{{}, {3, 4}}]:abs()

  local crit = nn.BoxRegressionCriterion(w)
  local loss = crit:forward({anchor_boxes, transforms}, target_boxes)
  local din = crit:backward({anchor_boxes, transforms}, target_boxes)
  local grad_anchor_boxes = din[1]
  local grad_transforms = din[2]
  
  local function f_anchors(x)
    return nn.BoxRegressionCriterion(w):forward({x, transforms}, target_boxes)
  end

  local function f_trans(x)
    return nn.BoxRegressionCriterion(w):forward({anchor_boxes, x}, target_boxes)
  end
  
  local grad_anchor_boxes_num = gradcheck.numeric_gradient(f_anchors, anchor_boxes)
  local grad_transforms_num = gradcheck.numeric_gradient(f_trans, transforms)

  local grad_anchor_err = gradcheck.relative_error(grad_anchor_boxes_num, grad_anchor_boxes)
  local grad_transforms_err = gradcheck.relative_error(grad_transforms_num, grad_transforms)

  tester:assertle(grad_anchor_err, 1e-4)
  tester:assertle(grad_transforms_err, 1e-4)
end


tester:add(tests)
tester:run()
