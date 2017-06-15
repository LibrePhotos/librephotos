require 'torch'

local box_utils = require 'densecap.box_utils'

local tests = {}
local tester = torch.Tester()


function tests.xcycwh_test()
  local boxes_in = torch.Tensor(1, 10, 4)
  
  boxes_in[{1, 1}] = torch.Tensor{0.5, 8.5, 7, 5}
  boxes_in[{1, 2}] = torch.Tensor{3.5, -0.5, 9, 7}
  boxes_in[{1, 3}] = torch.Tensor{9.5, 14.5, 7, 5}
  boxes_in[{1, 4}] = torch.Tensor{9, 7, 4, 4}
  boxes_in[{1, 5}] = torch.Tensor{11, 1.5, 2, 3}
  boxes_in[{1, 6}] = torch.Tensor{13, 1.5, 2, 2} -- out of bounds box in x
  boxes_in[{1, 7}] = torch.Tensor{1, 16, 3, 1} -- out of bounds box in y
  boxes_in[{1, 8}] = torch.Tensor{-5, 1, 3, 1} -- oob box in x
  boxes_in[{1, 9}] = torch.Tensor{-5, -6, 3, 1} -- oob box in both x,y
  boxes_in[{1, 10}] = torch.Tensor{15, 16, 3, 1} -- oob box in both x,y on other side
  
  local bounds = {
    x_min=0, x_max=12,
    y_min=0, y_max=15
  }
  local clipped, valid = box_utils.clip_boxes(boxes_in, bounds, 'xcycwh')
  
  local expected_clipped = boxes_in:clone()
  expected_clipped[{1, 1}] = torch.Tensor{2, 8.5, 4, 5}
  expected_clipped[{1, 2}] = torch.Tensor{4, 1.5, 8, 3}
  expected_clipped[{1, 3}] = torch.Tensor{9, 13.5, 6, 3}
  expected_clipped[{1, 4}] = torch.Tensor{9, 7, 4, 4}
  expected_clipped[{1, 5}] = torch.Tensor{11, 1.5, 2, 3}
  
  -- test correct clipping
  tester:assertTensorEq(clipped[{ {1}, {1,5} }], expected_clipped[{ {1}, {1,5} }], 0)

  -- test oob code
  local expected_valid = torch.FloatTensor{1,1,1,1,1,0,0,0,0,0}
  tester:asserteq(valid:type(), 'torch.ByteTensor', 'valid returns ByteTensor')
  tester:assertTensorEq(valid:float(), expected_valid, 0)
end


tester:add(tests)
tester:run()
