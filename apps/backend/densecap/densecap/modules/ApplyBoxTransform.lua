require 'nn'

local layer, parent = torch.class('nn.ApplyBoxTransform', 'nn.Module')

--[[

Apply adjustments to bounding boxes for bounding box regression, with
backpropagation both into box offsets and box positions.

We use the same parameterization for box regression as R-CNN:

Given a bounding box with center (xa, ya), width wa, and height ha,
and given offsets (tx, ty, tw, th), we compute the new bounding box
(x, y, w, h) as:

x = tx * wa + xa
y = ty * ha + ya
w = wa * exp(tw)
h = ha * exp(th)

This parameterization is nice because the identity transform is (0, 0, 0, 0).

Given gradients (dx, dy, dw, dh) on the output the gradients on the inputs are

dtx = wa * dx
dty = ha * dy
dtw = dw * wa * exp(tw) = dw * w
dth = dh * ha * exp(th) = dh * h

dxa = dx
dya = dy
dwa = dx * tx + dw * exp(tw)
dha = dy * ty + dh * exp(th)


Module input: A list of
- boxes: Tensor of shape (D1, D2, ..., 4) giving coordinates of boxes in
         (xc, yc, w, h) format.
- trans: Tensor of shape (D1, D2, ..., 4) giving box transformations in the form
         (tx, ty, tw, th)

Module output:
- Tensor of shape (D1, D2, ..., 4) giving coordinates of transformed boxes in
  (xc, yc, w, h) format. Output has same shape as input.

--]]


function layer:__init()
  parent.__init(self)
  self.gradInput = {torch.Tensor(), torch.Tensor()}
  self.buffer = torch.Tensor()
end


function layer:clearState()
  self.gradInput[1]:set()
  self.gradInput[2]:set()
  self.buffer:set()
end


function layer:updateOutput(input)
  local boxes, trans = input[1], input[2]

  assert(boxes:size(boxes:dim()) == 4, 'Last dim of boxes must be 4')
  assert(trans:size(trans:dim()) == 4, 'Last dim of trans must be 4')
  local boxes_view = boxes:contiguous():view(-1, 4)
  local trans_view = trans:contiguous():view(-1, 4)

  self.output:resizeAs(boxes)
  self.output_view = self.output:view(-1, 4)

  local xa = boxes_view[{{}, 1}]
  local ya = boxes_view[{{}, 2}]
  local wa = boxes_view[{{}, 3}]
  local ha = boxes_view[{{}, 4}]

  local tx = trans_view[{{}, 1}]
  local ty = trans_view[{{}, 2}]
  local tw = trans_view[{{}, 3}]
  local th = trans_view[{{}, 4}]

  self.output_view[{{}, 1}]:cmul(tx, wa):add(xa)
  self.output_view[{{}, 2}]:cmul(ty, ha):add(ya)
  self.output_view[{{}, 3}]:exp(tw):cmul(wa)
  self.output_view[{{}, 4}]:exp(th):cmul(ha)

  return self.output
end


function layer:updateGradInput(input, gradOutput)
  local boxes, trans = input[1], input[2]
  local boxes_view = boxes:view(-1, 4)
  local trans_view = trans:view(-1, 4)

  local gradBoxes, gradTrans = self.gradInput[1], self.gradInput[2]
  gradBoxes:resizeAs(boxes):zero()
  gradTrans:resizeAs(trans):zero()
  local gradBoxes_view = gradBoxes:view(-1, 4)
  local gradTrans_view = gradTrans:view(-1, 4)
  local gradOutput_view = gradOutput:view(-1, 4)

  local xa = boxes_view[{{}, 1}]
  local ya = boxes_view[{{}, 2}]
  local wa = boxes_view[{{}, 3}]
  local ha = boxes_view[{{}, 4}]

  local tx = trans_view[{{}, 1}]
  local ty = trans_view[{{}, 2}]
  local tw = trans_view[{{}, 3}]
  local th = trans_view[{{}, 4}]

  gradTrans_view[{{}, 1}]:cmul(gradOutput_view[{{}, 1}], wa)
  gradTrans_view[{{}, 2}]:cmul(gradOutput_view[{{}, 2}], ha)
  gradTrans_view[{{}, 3}]:cmul(self.output_view[{{}, 3}], gradOutput_view[{{}, 3}])
  gradTrans_view[{{}, 4}]:cmul(self.output_view[{{}, 4}], gradOutput_view[{{}, 4}])

  gradBoxes_view[{{}, 1}]:copy(gradOutput_view[{{}, 1}])
  gradBoxes_view[{{}, 2}]:copy(gradOutput_view[{{}, 2}])
  self.buffer:cmul(tx, gradOutput_view[{{}, 1}])
  gradBoxes_view[{{}, 3}]:exp(tw):cmul(gradOutput_view[{{}, 3}]):add(self.buffer)
  self.buffer:cmul(ty, gradOutput_view[{{}, 2}])
  gradBoxes_view[{{}, 4}]:exp(th):cmul(gradOutput_view[{{}, 4}]):add(self.buffer)
  
  return self.gradInput
end
