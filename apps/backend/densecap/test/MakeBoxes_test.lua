require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

require 'densecap.modules.MakeBoxes'
local gradcheck = require 'gradcheck'

local tests = {}
local tester = torch.Tester()


function tests.testCuda()
  local N, k, H, W = 2, 3, 4, 5
  local x0, y0, sx, sy = 1.0, 2.0, 10, 20
  local anchors = torch.randn(2, k):cuda()
  local input = torch.randn(N, 4 * k, H, W):cuda()
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors):cuda()
  local boxes = mod:forward(input)
  local dboxes = torch.randn(#boxes):cuda()
  local dinput = mod:backward(input, dboxes)
end


function tests.testBackwardNumeric()
  local N, k, H, W = 2, 3, 5, 7
  local x0, y0, sx, sy = 1.0, 2.0, 10, 20
  local anchors = torch.randn(2, k)
  local input = torch.randn(N, 4 * k, H, W)
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  local boxes = mod:forward(input)
  local dboxes = torch.randn(#boxes)
  local dinput = mod:backward(input, dboxes)

  local function f(x)
    return nn.MakeBoxes(x0, y0, sx, sy, anchors):forward(x)
  end
  
  local dinput_num = gradcheck.numeric_gradient(f, input, dboxes)
  
  tester:assertle(gradcheck.relative_error(dinput, dinput_num, 1e-7), 1e-5)
  -- tester:assertTensorEq(dinput, dinput_num, 1e-6)
end

-- Test with one anchor, one cell, minibatch size 1, zero inputs
-- This should just copy x0, y0, and anchor to output boxes
function tests.simpleTestForward()
  local N, k, H, W = 1, 1, 1, 1
  local x0, y0, sx, sy = 1.5, 2.5, 1.0, 1.0
  local anchors = torch.Tensor({{10}, {20}})
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({1.5, 2.5, 10, 20})
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end

-- One cell, minibatch size 1, zero inputs, but three anchors
function tests.multipleAnchorsForward()
  local N, k, H, W = 1, 3, 1, 1
  local x0, y0, sx, sy = 1.5, 2.5, 1.0, 1.0
  local anchors = torch.Tensor({
                    {10, 30, 100},
                    {20, 40, 200}
                  })
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({1.5, 2.5, 10, 20})
  expected_boxes[{1, 1, 1, 2}] = torch.Tensor({1.5, 2.5, 30, 40})
  expected_boxes[{1, 1, 1, 3}] = torch.Tensor({1.5, 2.5, 100, 200})
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end

-- 2 x 3 grid of inputs, minibatch size 1, one anchor, zero inputs
function tests.multipleCellsForward()
  local N, k, H, W = 1, 1, 2, 3
  local x0, y0, sx, sy = 1.5, 2.5, 1.0, 2.0
  local anchors = torch.Tensor({{10}, {20}})
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({1.5, 2.5, 10, 20})
  expected_boxes[{1, 1, 2, 1}] = torch.Tensor({2.5, 2.5, 10, 20})
  expected_boxes[{1, 1, 3, 1}] = torch.Tensor({3.5, 2.5, 10, 20})
  expected_boxes[{1, 2, 1, 1}] = torch.Tensor({1.5, 4.5, 10, 20})
  expected_boxes[{1, 2, 2, 1}] = torch.Tensor({2.5, 4.5, 10, 20})
  expected_boxes[{1, 2, 3, 1}] = torch.Tensor({3.5, 4.5, 10, 20})
    
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end

function tests.testMinibatchForward()
  local N, k, H, W = 2, 1, 1, 1
  local x0, y0, sx, sy = 2.0, 3.0, 10.0, 20.0
  local anchors = torch.Tensor({{100}, {200}})
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({2.0, 3.0, 100, 200})
  expected_boxes[{2, 1, 1, 1}] = torch.Tensor({2.0, 3.0, 100, 200})
 
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end


function tests.testOffsetForward()
  local N, k, H, W = 2, 2, 1, 1
  local x0, y0, sx, sy = 2.0, 3.0, 1.0, 2.0
  local anchors = torch.Tensor({{100, 10}, {200, 20}})
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  input[{1, {1, 4}, 1, 1}] = torch.Tensor({0.25, 0.1, 0, 0})
  input[{1, {5, 8}, 1, 1}] = torch.Tensor({0.1, 0.25, 0, 0})
  input[{2, {1, 4}, 1, 1}] = torch.Tensor({0, 0.05, 0, 0})
  input[{2, {5, 8}, 1, 1}] = torch.Tensor({0.05, 0, 0, 0})
  
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({27.0, 23.0, 100, 200})
  expected_boxes[{1, 1, 1, 2}] = torch.Tensor({3.0, 8.0, 10, 20})
  expected_boxes[{2, 1, 1, 1}] = torch.Tensor({2, 13, 100, 200})
  expected_boxes[{2, 1, 1, 2}] = torch.Tensor({2.5, 3, 10, 20})
  
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end


function tests.testScaleForward()
  local N, k, H, W = 2, 2, 1, 1
  local x0, y0, sx, sy = 2.0, 3.0, 1.0, 2.0
  local anchors = torch.Tensor({{100, 10}, {200, 20}})
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  
  local log1_1 = 0.095310179804325
  local log2 = 0.69314718055995
  local log1_5 = 0.40546510810816
  input[{1, {1, 4}, 1, 1}] = torch.Tensor({0, 0, log1_1, 0})
  input[{1, {5, 8}, 1, 1}] = torch.Tensor({0, 0, 0, log2})
  input[{2, {1, 4}, 1, 1}] = torch.Tensor({0, 0, log1_5, log1_1})
  input[{2, {5, 8}, 1, 1}] = torch.Tensor({0, 0, log2, log1_5})
  
  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({2, 3, 110, 200})
  expected_boxes[{1, 1, 1, 2}] = torch.Tensor({2, 3, 10, 40})
  expected_boxes[{2, 1, 1, 1}] = torch.Tensor({2, 3, 150, 220})
  expected_boxes[{2, 1, 1, 2}] = torch.Tensor({2, 3, 20, 30})
  
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end


function tests.bigTestForward()
  local N, k, H, W = 2, 2, 2, 2
  local x0, y0, sx, sy = 2.0, 3.0, 1.0, 2.0
  local anchors = torch.Tensor({{100, 10}, {200, 20}})
  local input = torch.Tensor(N, 4 * k, H, W):zero()
  
  local log0_5 = -0.69314718055995
  local log1_1 = 0.095310179804325
  local log2 = 0.69314718055995
  local log1_5 = 0.40546510810816
  local log0_9 = -0.10536051565783
  
  -- input[1]
  input[{1, {1, 4}, 1, 1}] = torch.Tensor({0, 0, 0, 0})
  input[{1, {5, 8}, 1, 1}] = torch.Tensor({0, 0, 0, log1_5})
  
  input[{1, {1, 4}, 1, 2}] = torch.Tensor({0, 0, log0_5, 0})
  input[{1, {5, 8}, 1, 2}] = torch.Tensor({0, 0, log2, log1_5})
  
  input[{1, {1, 4}, 2, 1}] = torch.Tensor({0, -0.02, 0, 0})
  input[{1, {5, 8}, 2, 1}] = torch.Tensor({0, 0.1, 0, log1_5})

  input[{1, {1, 4}, 2, 2}] = torch.Tensor({0, 0.1, log1_1, 0})
  input[{1, {5, 8}, 2, 2}] = torch.Tensor({0, 0.25, log1_5, log2})
  
  -- input[2]
  input[{2, {1, 4}, 1, 1}] = torch.Tensor({-0.05, 0, 0, 0})
  input[{2, {5, 8}, 1, 1}] = torch.Tensor({0.5, 0, 0, log0_5})
  
  input[{2, {1, 4}, 1, 2}] = torch.Tensor({0.1, 0, log1_1, 0})
  input[{2, {5, 8}, 1, 2}] = torch.Tensor({0.2, 0, log0_5, log1_5})
  

  input[{2, {1, 4}, 2, 1}] = torch.Tensor({-0.01, 0.1, 0, 0})
  input[{2, {5, 8}, 2, 1}] = torch.Tensor({1.1, 2.0, 0, log2})

  input[{2, {1, 4}, 2, 2}] = torch.Tensor({-1, 1, log0_9, 0})
  input[{2, {5, 8}, 2, 2}] = torch.Tensor({0.1, -0.2, log1_1, log0_9})
  

  local mod = nn.MakeBoxes(x0, y0, sx, sy, anchors)
  mod:forward(input)
  
  local expected_boxes = torch.Tensor(N, H, W, k, 4)
  expected_boxes[{1, 1, 1, 1}] = torch.Tensor({2, 3, 100, 200})
  expected_boxes[{1, 1, 1, 2}] = torch.Tensor({2, 3, 10, 30})
  
  expected_boxes[{1, 1, 2, 1}] = torch.Tensor({3, 3, 50, 200})
  expected_boxes[{1, 1, 2, 2}] = torch.Tensor({3, 3, 20, 30})
  
  expected_boxes[{1, 2, 1, 1}] = torch.Tensor({2, 1, 100, 200})
  expected_boxes[{1, 2, 1, 2}] = torch.Tensor({2, 7, 10, 30})

  expected_boxes[{1, 2, 2, 1}] = torch.Tensor({3, 25, 110, 200})
  expected_boxes[{1, 2, 2, 2}] = torch.Tensor({3, 10, 15, 40})
  
  
  expected_boxes[{2, 1, 1, 1}] = torch.Tensor({-3, 3, 100, 200})
  expected_boxes[{2, 1, 1, 2}] = torch.Tensor({7, 3, 10, 10})
  
  expected_boxes[{2, 1, 2, 1}] = torch.Tensor({13, 3, 110, 200})
  expected_boxes[{2, 1, 2, 2}] = torch.Tensor({5, 3, 5, 30})
  
  expected_boxes[{2, 2, 1, 1}] = torch.Tensor({1, 25, 100, 200})
  expected_boxes[{2, 2, 1, 2}] = torch.Tensor({13, 45, 10, 40})

  expected_boxes[{2, 2, 2, 1}] = torch.Tensor({-97, 205, 90, 200})
  expected_boxes[{2, 2, 2, 2}] = torch.Tensor({4, 1, 11, 18})

  expected_boxes = expected_boxes:permute(1, 4, 2, 3, 5)
  
  tester:assertTensorEq(mod.boxes, expected_boxes, 1e-4)
end


tester:add(tests)
tester:run()