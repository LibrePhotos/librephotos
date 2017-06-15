local box_utils = require 'densecap.box_utils'


local tester = torch.Tester()
local tests = {}


--[[
Make sure that converting from (x1, y1, x2, y2) format to (x, y, w, h) format and back
gives the same results.
--]]
function tests.x1y1x2y2_to_xywh_inverse_test()
  local N = 100
  local boxes_xywh = torch.randn(N, 4)
  boxes_xywh[{{}, {3, 4}}]:abs()
  
  local boxes_x1y1x2y2 = box_utils.xywh_to_x1y1x2y2(boxes_xywh)
  local boxes_xywh_2 = box_utils.x1y1x2y2_to_xywh(boxes_x1y1x2y2)
  local boxes_x1y1x2y2_2 = box_utils.xywh_to_x1y1x2y2(boxes_xywh_2)
  
  tester:assertTensorEq(boxes_x1y1x2y2, boxes_x1y1x2y2_2, 1e-6)
  tester:assertTensorEq(boxes_xywh, boxes_xywh_2, 1e-6)
end



tester:add(tests)
tester:run()
