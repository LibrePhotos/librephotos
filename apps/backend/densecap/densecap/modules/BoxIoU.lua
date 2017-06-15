require 'nn'
local box_utils = require 'densecap.box_utils'
local layer, parent = torch.class('nn.BoxIoU', 'nn.Module')


function layer:__init()
  parent.__init(self)
  
  self.area1 = torch.Tensor()
  self.area2 = torch.Tensor()
  self.overlap = torch.Tensor()
end


-- Convert from (xc, yc, w, h) to (x0, y0, x1, y1)
--[[
local function convert_boxes(boxes)
  local ret = boxes.new(#boxes)
  
  local xc = boxes:select(3, 1)
  local yc = boxes:select(3, 2)
  local w  = boxes:select(3, 3)
  local h  = boxes:select(3, 4)
  
  local x0 = ret:select(3, 1)
  local x1 = ret:select(3, 3)
  local y0 = ret:select(3, 2)
  local y1 = ret:select(3, 4)
  
  x0:div(w, 2.0):mul(-1):add(xc)
  x1:div(w, 2.0):add(xc)
  y0:div(h, 2.0):mul(-1):add(yc)
  y1:div(h, 2.0):add(yc)
  
  return ret
end
--]]


function layer:updateOutput(input)
  local box1 = input[1]
  local box2 = input[2]
  local N, B1, B2 = box1:size(1), box1:size(2), box2:size(2)
  self.area1:cmul(box1[{{}, {}, 3}], box1[{{}, {}, 4}])
  self.area2:cmul(box2[{{}, {}, 3}], box2[{{}, {}, 4}])
  local area1_expand = self.area1:view(N, B1, 1):expand(N, B1, B2)
  local area2_expand = self.area2:view(N, 1, B2):expand(N, B1, B2)
  
  local convert_boxes = box_utils.xcycwh_to_x1y1x2y2
  local box1_lohi = convert_boxes(box1) -- N x B1 x 4
  local box2_lohi = convert_boxes(box2) -- N x B2 x 4
  local box1_lohi_expand = box1_lohi:view(N, B1, 1, 4):expand(N, B1, B2, 4)
  local box2_lohi_expand = box2_lohi:view(N, 1, B2, 4):expand(N, B1, B2, 4)
  
  local x0 = torch.cmax(box1_lohi_expand:select(4, 1),
                        box2_lohi_expand:select(4, 1))
  local y0 = torch.cmax(box1_lohi_expand:select(4, 2),
                        box2_lohi_expand:select(4, 2))
  local x1 = torch.cmin(box1_lohi_expand:select(4, 3),
                        box2_lohi_expand:select(4, 3))
  local y1 = torch.cmin(box1_lohi_expand:select(4, 4),
                        box2_lohi_expand:select(4, 4))
  
  local w = (x1 - x0):cmax(0)
  local h = (y1 - y0):cmax(0)
  
  local intersection = torch.cmul(w, h)
  self.output:add(area1_expand, -1, intersection)
  self.output:add(area2_expand):pow(-1)
  self.output:cmul(intersection)
  
  return self.output
end


function layer:updateGradInput(input, gradOutput)
  error('Not implemented')
end

