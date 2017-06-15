require 'nn'
require 'densecap.modules.InvertBoxTransform'
require 'densecap.modules.ApplyBoxTransform'

local crit, parent = torch.class('nn.BoxRegressionCriterion', 'nn.Criterion')

--------------------------------------------------------------------------------
--[[
A criterion for bounding box regression losses.

For bounding box regression, we always predict transforms on top of anchor boxes.
Instead of directly penalizing the difference between the ground-truth box and
predicted boxes, penalize the difference between the transforms and the optimal
transforms that would have converted the anchor boxes into the ground-truth boxes.

This criterion accepts as input the anchor boxes, transforms, and target boxes;
on the forward pass it uses the anchors and target boxes to compute target tranforms,
and returns the loss between the input transforms and computed target transforms.

On the backward pass we compute the gradient of this loss with respect to both the
input transforms and the input anchor boxes.

Inputs:
- input: A list of:
  - anchor_boxes: Tensor of shape (B, 4) giving anchor box coords as (xc, yc, w, h)
  - transforms: Tensor of shape (B, 4) giving transforms as (tx, ty, tw, th)
- target_boxes: Tensor of shape (B, 4) giving target boxes as (xc, yc, w, h)
--]]

function crit:__init(w)
  parent.__init(self)
  self.w = w or 1.0
  self.invert_transform = nn.InvertBoxTransform()
  self.target_transforms = nil
  self.smooth_l1 = nn.SmoothL1Criterion()
  self.gradInput = {torch.Tensor(), torch.Tensor()}
  self.mask = nil
end


function crit:clearState()
  self.invert_transform:clearState()
  self.target_transforms = nil
  self.gradInput[1]:set()
  self.gradInput[2]:set()
  self.mask = nil
end


function crit:updateOutput(input, target_boxes)
  local anchor_boxes, transforms = unpack(input)
  self.target_transforms = self.invert_transform:forward{anchor_boxes, target_boxes}

  -- DIRTY DIRTY HACK: Ignore loss for boxes whose transforms are too big
  self.mask = torch.gt(torch.abs(self.target_transforms):max(2), 10)
  self.mask = self.mask:expandAs(self.target_transforms)
  local mask_sum = self.mask:sum() / 4
  if mask_sum > 0 then
    local msg = 'WARNING: Ignoring %d boxes in BoxRegressionCriterion'
    print(string.format(msg, mask_sum))
    transforms[self.mask] = 0
    self.target_transforms[self.mask] = 0
  end

  self.output = self.w * self.smooth_l1:forward(transforms, self.target_transforms)
  return self.output
end


function crit:updateGradInput(input, target_boxes)
  local anchor_boxes, transforms = unpack(input)
  local grad_transforms = self.smooth_l1:backward(transforms, self.target_transforms)
  grad_transforms:mul(self.w)
  self.gradInput[2]:resizeAs(grad_transforms)
  self.gradInput[2]:copy(grad_transforms)
  local din = self.invert_transform:backward({anchor_boxes, target_boxes}, grad_transforms)
  self.gradInput[1]:mul(din[1], -1)
  return self.gradInput
end
