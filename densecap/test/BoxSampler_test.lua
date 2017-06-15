require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

local utils = require 'utils'
require 'densecap.modules.BoxSampler'

local tests = {}
local tester = torch.Tester()


-- tester:assertTensorEq doesn't work for ByteTensors since it depends
-- on the :abs() method which is not implemented for ByteTensor.
function tester:assertByteTensorEq(a, b)
  self:assert(torch.all(torch.eq(a, b)))
end


function tests.simpleTest()
  local N, B1, B2 = 1, 10, 3
  local batch_size = 4
  local low_thresh, high_thresh = 0.2, 0.4

  local input_boxes = torch.Tensor(N, B1, 4)
  local target_boxes = torch.Tensor(N, B2, 4)

  input_boxes[{1, 1}]  = torch.Tensor{-4, 6, 4, 4}
  input_boxes[{1, 2}]  = torch.Tensor{-6.5, 1.5, 2, 6}
  input_boxes[{1, 3}]  = torch.Tensor{-4.5, -0.5, 6, 6}
  input_boxes[{1, 4}]  = torch.Tensor{-6.5, -6.5, 3, 3}
  input_boxes[{1, 5}]  = torch.Tensor{-0.5, -7.5, 3, 3}
  input_boxes[{1, 6}]  = torch.Tensor{7.5, -5.5, 3, 5}
  input_boxes[{1, 7}]  = torch.Tensor{5.5, -3, 6, 3}
  input_boxes[{1, 8}]  = torch.Tensor{4.5, 2, 3, 7}
  input_boxes[{1, 9}]  = torch.Tensor{6.5, 5, 6, 3}
  input_boxes[{1, 10}] = torch.Tensor{4, 5, 3, 5}

  target_boxes[{1, 1}] = torch.Tensor{-6.5, 1.5, 3, 7}
  target_boxes[{1, 2}] = torch.Tensor{4.5, 4.5, 3, 5}
  target_boxes[{1, 3}] = torch.Tensor{5, -2.5, 6, 3}
  
  local mod = nn.BoxSampler{
                batch_size=batch_size,
                low_thresh=low_thresh,
                high_thresh=high_thresh,
              }
  mod.debug_pos_sample_idx = torch.LongTensor{2, 3}
  mod.debug_neg_sample_idx = torch.LongTensor{1, 4}
  local output = mod:forward{input_boxes, target_boxes}
  local pos_input_idx = output[1]
  local pos_target_idx = output[2]
  local neg_input_idx = output[3]
  
  local expected_pos_mask =
    torch.ByteTensor{0, 1, 0, 0, 0, 0, 1, 1, 0, 1}
  local expected_neg_mask = 
    torch.ByteTensor{1, 0, 0, 1, 1, 1, 0, 0, 0, 0}
  tester:assertByteTensorEq(expected_pos_mask, mod.pos_mask)
  tester:assertByteTensorEq(expected_neg_mask, mod.neg_mask)
  
  local expected_pos_input_idx = torch.LongTensor{7, 8}
  local expected_pos_target_idx = torch.LongTensor{3, 2}
  local expected_neg_input_idx = torch.LongTensor{1, 6}
  tester:assertTensorEq(pos_input_idx, expected_pos_input_idx, 0)
  tester:assertTensorEq(pos_target_idx, expected_pos_target_idx, 0)
  tester:assertTensorEq(neg_input_idx, expected_neg_input_idx, 0)
end

--[[
This tests two things:

(1) The input box with the largest IoU with each target box
    is counted as positive, even if that IoU is less than the
    high_thresh.
(2) If we don't have enough positive boxes to fill out the
    minibatch then it gets filled out with negative boxes.
--]]
function tests.anotherTest()
  local N, B1, B2 = 1, 4, 1
  local batch_size = 4

  local input_boxes = torch.Tensor(N, B1, 4)
  local target_boxes = torch.Tensor(N, B2, 4)
  
  input_boxes[{1, 1}]  = torch.Tensor{4, 8, 2, 2}
  input_boxes[{1, 2}]  = torch.Tensor{6.5, 5, 3, 2}
  input_boxes[{1, 3}]  = torch.Tensor{3.5, 1, 3, 4}
  input_boxes[{1, 4}]  = torch.Tensor{8, 8, 2, 2}
  
  target_boxes[{1, 1}] = torch.Tensor{4.5, 4, 3, 4}
  
  local mod = nn.BoxSampler{batch_size=batch_size}
  
  local output = mod:forward{input_boxes, target_boxes}
  local pos_input_idx = output[1]
  local pos_target_idx = output[2]
  local neg_input_idx = output[3]
  
  -- The IoU between input_boxes[2] and target_boxes[1] is only
  -- 0.125 which is below the threshold for positive boxes;
  -- however it should still count as positive since it is the input
  -- box with the highest overlap with the target box.
  
  local expected_pos_mask = torch.ByteTensor{0, 1, 0, 0}
  local expected_neg_mask = torch.ByteTensor{1, 0, 1, 1}
  tester:assertByteTensorEq(expected_pos_mask, mod.pos_mask)
  tester:assertByteTensorEq(expected_neg_mask, mod.neg_mask)
  
  -- Since there should be only one positive box, there is only one
  -- posibility for pos_input_idx and pos_target_idx.
  local expected_pos_input_idx = torch.LongTensor{2}
  local expected_pos_target_idx = torch.LongTensor{1}
  tester:assertTensorEq(pos_input_idx, expected_pos_input_idx, 0)
  tester:assertTensorEq(pos_target_idx, expected_pos_target_idx, 0)
  
  -- Since we requested batch_size = 4 and there is only one positive
  -- box, neg_input_idx must be a permutation of {1, 3, 4}; therefore
  -- if we sort it we have to get {1, 3, 4}.
  local neg_input_idx_sorted = torch.sort(neg_input_idx)
  local expected_neg_input_idx = torch.LongTensor{1, 3, 4}
  tester:assertTensorEq(neg_input_idx_sorted, expected_neg_input_idx, 0)
end


-- test to exercise the bounds clipping
function tests.boundsTest()
  local N, B1, B2 = 1, 10, 3
  local batch_size = 4
  local low_thresh, high_thresh = 0.2, 0.4

  local input_boxes = torch.Tensor(N, B1, 4)
  local target_boxes = torch.Tensor(N, B2, 4)

  input_boxes[{1, 1}]  = torch.Tensor{-4, 6, 4, 4}
  input_boxes[{1, 2}]  = torch.Tensor{-6.5, 1.5, 2, 6}
  input_boxes[{1, 3}]  = torch.Tensor{-4.5, -0.5, 6, 6}
  input_boxes[{1, 4}]  = torch.Tensor{-6.5, -6.5, 3, 3}
  input_boxes[{1, 5}]  = torch.Tensor{0.5, -7.5, 3, 3}
  input_boxes[{1, 6}]  = torch.Tensor{7.5, -5.5, 3, 5}
  input_boxes[{1, 7}]  = torch.Tensor{5.5, -3, 6, 3}
  input_boxes[{1, 8}]  = torch.Tensor{4.5, 2, 3, 7}
  input_boxes[{1, 9}]  = torch.Tensor{6.5, 5, 6, 3}
  input_boxes[{1, 10}] = torch.Tensor{4, 5, 3, 5}

  target_boxes[{1, 1}] = torch.Tensor{-6.5, 1.5, 3, 7}
  target_boxes[{1, 2}] = torch.Tensor{4.5, 4.5, 3, 5}
  target_boxes[{1, 3}] = torch.Tensor{5, -2.5, 6, 3}

  local mod = nn.BoxSampler{
                batch_size=batch_size,
                low_thresh=low_thresh,
                high_thresh=high_thresh,
              }
  mod:setBounds{x_min=-1, x_max=9, y_min=-9, y_max=8}
  mod.debug_pos_sample_idx = torch.LongTensor{2, 3}
  mod.debug_neg_sample_idx = torch.LongTensor{1, 2}
  local output = mod:forward{input_boxes, target_boxes}
  local pos_input_idx = output[1]
  local pos_target_idx = output[2]
  local neg_input_idx = output[3]

  -- input_boxes[{1, 2}] is out of bounds, but it still counts as a positive
  -- because it has maximal IoU with the first target box.
  local expected_pos_mask =
    torch.ByteTensor{0, 1, 0, 0, 0, 0, 1, 1, 0, 1}
  local expected_neg_mask =
    torch.ByteTensor{0, 0, 0, 0, 1, 1, 0, 0, 0, 0}

  tester:assertByteTensorEq(expected_pos_mask, mod.pos_mask)
  tester:assertByteTensorEq(expected_neg_mask, mod.neg_mask)
end


-- Make sure the sampler works when there are not enough negatives to fill out
-- the requested minibatch size (it should fall back to sampling with replacement)
function tests.negativeReplacementTest()
  local N, B1, B2 = 1, 10, 3
  local batch_size = 64

  local input_boxes = torch.randn(N, B1, 4)
  local target_boxes = torch.randn(N, B2, 4)

  local mod = nn.BoxSampler{batch_size=batch_size}

  local output = mod:forward{input_boxes, target_boxes}

  local pos_input_idx, pos_target_idx, neg_input_idx = unpack(output)
  tester:asserteq(pos_input_idx:size(1), pos_target_idx:size(1))
  tester:asserteq(pos_input_idx:size(1) + neg_input_idx:size(1), batch_size)
end


-- Test the case where there are no negatives;
-- this should fall back by setting the neg mask to be the inverse
-- of the pos mask and also increment a counter in the global stats.
function tests.noNegativesTest()
  local N, B1, B2 = 1, 4, 2
  local low_thresh, high_thresh = 0.25, 0.3
  
  local input_boxes = torch.Tensor(N, B1, 4)
  local target_boxes = torch.Tensor(N, B2, 4)

  input_boxes[{1, 1}] = torch.Tensor{3, 10, 2, 2}
  input_boxes[{1, 2}] = torch.Tensor{7, 6.5, 4, 3}
  input_boxes[{1, 3}] = torch.Tensor{8, 1.5, 2, 3}
  input_boxes[{1, 4}] = torch.Tensor{10, 2.5, 2, 3}

  target_boxes[{1, 1}] = torch.Tensor{6, 5.5, 4, 3}
  target_boxes[{1, 2}] = torch.Tensor{9, 1.5, 2, 3}

  local mod = nn.BoxSampler{
                batch_size=batch_size,
                low_thresh=low_thresh,
                high_thresh=high_thresh,
              }
  mod:setBounds{x_min=0, x_max=10, y_min=0, y_max=10}

  -- inputs 2 and 3 will be positives since they have maximal iou with the
  -- targets; the other two boxes are out of bounds, so they won't be negatives.
  -- Thus we will have no negative boxes, and the code will crash if it doesn't
  -- handle this case.

  -- Instead of just checking that the counter is 1 after the call, we'll instead
  -- make sure that the counter is incremented just in case one of the other random
  -- tests cased it to increment.
  local k = 'BoxSampler no negatives'
  local old_counter_value = utils.__GLOBAL_STATS__[k] or 0

  mod:forward{input_boxes, target_boxes}

  tester:asserteq(utils.__GLOBAL_STATS__[k], old_counter_value + 1)

  local expected_pos_mask = torch.ByteTensor{0, 1, 1, 0}
  local expected_neg_mask = torch.ByteTensor{1, 0, 0, 1}
  tester:assertByteTensorEq(expected_pos_mask, mod.pos_mask)
  tester:assertByteTensorEq(expected_neg_mask, mod.neg_mask)  
end

tester:add(tests)
tester:run()
