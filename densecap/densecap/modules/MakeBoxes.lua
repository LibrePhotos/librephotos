local layer, parent = torch.class('nn.MakeBoxes', 'nn.Module')

--[[
  Inputs:
  - x0, y0: Numbers giving coordinates of receptive field center for upper left
    corner of inputs.
  - sx, sy: Numbers giving horizontal and vertical stride between receptive
    field centers.
  - anchors: Tensor of shape 2 x k giving width and height for each of k
    anchor boxes.
--]]
function layer:__init(x0, y0, sx, sy, anchors)
  parent.__init(self)
  self.x0 = x0
  self.y0 = y0
  self.sx = sx
  self.sy = sy
  self.anchors = anchors:clone()
  
  self.input_perm = torch.Tensor()
  self.boxes = torch.Tensor()
  self.raw_anchors = torch.Tensor()
  self.wa_expand = nil
  self.ha_expand = nil

  self.dtx = torch.Tensor()
  self.dty = torch.Tensor()
  self.dtw = torch.Tensor()
  self.dth = torch.Tensor()
end


--[[
  input: Tensor of shape N x 4k x H x W
  output: Tensor of shape N x (k*H*W) x 4
--]]
function layer:updateOutput(input)
  local N, H, W = input:size(1), input:size(3), input:size(4)
  local k = input:size(2) / 4
  self.boxes:resize(N, k, H, W, 4)
  
  -- Unpack x, y, w, h from boxes; these are the centers and sizes of
  -- the generated boxes, each of shape N x H x W x k
  local x = self.boxes[{{}, {}, {}, {}, 1}]
  local y = self.boxes[{{}, {}, {}, {}, 2}]
  local w = self.boxes[{{}, {}, {}, {}, 3}]
  local h = self.boxes[{{}, {}, {}, {}, 4}]
  
  -- Reshape input from N x 4k x H x W to N x k x 4 x H x W
  local input_view = input:view(N, k, 4, H, W)
  
  -- Unpack tx, ty, tw, th from input
  -- Each of these is N x k x H x W
  local tx = input_view[{{}, {}, 1}]
  local ty = input_view[{{}, {}, 2}]
  local tw = input_view[{{}, {}, 3}]
  local th = input_view[{{}, {}, 4}]
  
  -- Unpack wa, ha from anchors; each has shape k, so we need to expand
  local wa, ha = self.anchors[1], self.anchors[2]
  self.wa_expand = wa:view(1, k, 1, 1):expand(N, k, H, W)
  self.ha_expand = ha:view(1, k, 1, 1):expand(N, k, H, W)
  
  -- Compute xa and ya using x0, sx, y0, sy
  -- We also need to expand them
  local xa = torch.range(0, W - 1):typeAs(input):mul(self.sx):add(self.x0)
  local ya = torch.range(0, H - 1):typeAs(input):mul(self.sy):add(self.y0)
  local xa_expand = xa:view(1, 1, 1, W):expand(N, k, H, W)
  local ya_expand = ya:view(1, 1, H, 1):expand(N, k, H, W)

  -- N x k x H x W x 4
  self.raw_anchors:resizeAs(self.boxes)
  self.raw_anchors:select(5, 1):copy(xa_expand)
  self.raw_anchors:select(5, 2):copy(ya_expand)
  self.raw_anchors:select(5, 3):copy(self.wa_expand)
  self.raw_anchors:select(5, 4):copy(self.ha_expand)
  self.raw_anchors = self.raw_anchors:view(N, k * H * W, 4)
  
  -- Compute x = wa * tx + xa, y = ha * tx + ya
  x:cmul(self.wa_expand, tx):add(xa_expand)
  y:cmul(self.ha_expand, ty):add(ya_expand)
  
  -- Compute w = wa * exp(tw) and h = ha * exp(th)
  -- (which comes from tw = log(w / wa), th = log(h / ha))
  w:exp(tw):cmul(self.wa_expand)
  h:exp(th):cmul(self.ha_expand)
  
  self.output = self.boxes:view(N, k * H * W, 4)
  return self.output
end


-- This will only work properly if forward was just called
function layer:updateGradInput(input, gradOutput)
  local N, H, W = input:size(1), input:size(3), input:size(4)
  local k = input:size(2) / 4

  self.gradInput:resizeAs(input):zero()

  local dboxes = gradOutput:view(N, k, H, W, 4)
  local dx = dboxes[{{}, {}, {}, {}, 1}]
  local dy = dboxes[{{}, {}, {}, {}, 2}]
  local dw = dboxes[{{}, {}, {}, {}, 3}]
  local dh = dboxes[{{}, {}, {}, {}, 4}]

  self.dtx:cmul(self.wa_expand, dx)
  self.dty:cmul(self.ha_expand, dy)

  local w = self.boxes[{{}, {}, {}, {}, 3}]
  local h = self.boxes[{{}, {}, {}, {}, 4}]
  self.dtw:cmul(w, dw)
  self.dth:cmul(h, dh)

  local gradInput_view = self.gradInput:view(N, k, 4, H, W)
  gradInput_view[{{}, {}, 1}] = self.dtx
  gradInput_view[{{}, {}, 2}] = self.dty
  gradInput_view[{{}, {}, 3}] = self.dtw
  gradInput_view[{{}, {}, 4}] = self.dth

  return self.gradInput
end
