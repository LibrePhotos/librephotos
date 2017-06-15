require 'nn'

local layer, parent = torch.class('nn.InvertBoxTransform', 'nn.Module')

--[[
Given anchor boxes and target boxes, compute the box transform parameters that
would be needed to transform the anchors into the targets. This is an inverse
for ApplyBoxTransform.

Inputs:
- anchor_boxes: Tensor of shape (B, 4) giving coordinates for B anchor boxes in
  (xc, yc, w, h) format.
- target_boxes: Tensor of shape (B, 4) giving coordinates for B target boxes in
  (xc, yc, w, h) format.

Outputs:
- trans: Tensor of shape (B, 4) giving box transforms in the format
  (tx, ty, tw, th) such that applying trans[i] to anchor_boxes[i] gives
  target_boxes[i].
--]]


function layer:__init()
  parent.__init(self)
  self.gradInput = {torch.Tensor(), torch.Tensor()}
end


function layer:clearState()
  self.output:set()
  self.gradInput[1]:set()
  self.gradInput[2]:set()
end


function layer:updateOutput(input)
  local anchor_boxes, target_boxes = input[1], input[2]

  local xa = anchor_boxes[{{}, 1}]
  local ya = anchor_boxes[{{}, 2}]
  local wa = anchor_boxes[{{}, 3}]
  local ha = anchor_boxes[{{}, 4}]

  local xt = target_boxes[{{}, 1}]
  local yt = target_boxes[{{}, 2}]
  local wt = target_boxes[{{}, 3}]
  local ht = target_boxes[{{}, 4}]

  self.output:resizeAs(target_boxes)
  self.output[{{}, 1}]:add(xt, -1, xa):cdiv(wa)
  self.output[{{}, 2}]:add(yt, -1, ya):cdiv(ha)

  -- TODO if the division is unstable we could replace with
  -- log(wt) - log(wa) but it should be fine since we are dividing by
  -- anchor widths and heights which should be nonzero.
  self.output[{{}, 3}]:cdiv(wt, wa):log()
  self.output[{{}, 4}]:cdiv(ht, ha):log()

  return self.output
end


function layer:updateGradInput(input, gradOutput)
  local anchor_boxes, target_boxes = input[1], input[2]
  local grad_anchor_boxes, grad_target_boxes = unpack(self.gradInput)
  
  grad_anchor_boxes:resizeAs(anchor_boxes):zero()
  grad_target_boxes:resizeAs(target_boxes):zero()
  
  local xa = anchor_boxes[{{}, 1}]
  local ya = anchor_boxes[{{}, 2}]
  local wa = anchor_boxes[{{}, 3}]
  local ha = anchor_boxes[{{}, 4}]

  local xt = target_boxes[{{}, 1}]
  local yt = target_boxes[{{}, 2}]
  local wt = target_boxes[{{}, 3}]
  local ht = target_boxes[{{}, 4}]

  local dtx = gradOutput[{{}, 1}]
  local dty = gradOutput[{{}, 2}]
  local dtw = gradOutput[{{}, 3}]
  local dth = gradOutput[{{}, 4}]

  grad_anchor_boxes[{{}, 1}]:cdiv(dtx, wa):mul(-1)
  grad_anchor_boxes[{{}, 2}]:cdiv(dty, ha):mul(-1)
  local tx = self.output[{{}, 1}]
  grad_anchor_boxes[{{}, 3}]:cmul(tx, dtx):add(dtw):cdiv(wa):mul(-1)
  local ty = self.output[{{}, 2}]
  grad_anchor_boxes[{{}, 4}]:cmul(ty, dty):add(dth):cdiv(ha):mul(-1)
  
  grad_target_boxes[{{}, 1}]:cdiv(dtx, wa)
  grad_target_boxes[{{}, 2}]:cdiv(dty, ha)
  grad_target_boxes[{{}, 3}]:cdiv(dtw, wt)
  grad_target_boxes[{{}, 4}]:cdiv(dth, ht)
  
  return self.gradInput
end
