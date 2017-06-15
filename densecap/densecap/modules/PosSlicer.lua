local layer, parent = torch.class('nn.PosSlicer', 'nn.Module')

--[[

A PosSlicer receives two inputs:
- features: Tensor of shape (N, d1, ..., dk)
- gt_features: Tensor of shape (P, e1, ..., en) or an empty Tensor

If gt_features is not empty, then return the first P rows of features
(along the first dimension). If gt_features is nil, then just return
features.

This operation is needed in the recognition network. At training time, the
LocalizationLayer produces both positive and negative regions of interest, with
the positive regions first in the minibatch. We only want to run the language
model and final box regression on the positive minibatch elements, so we use
the ground-truth box coordinates from the LocalizationLayer to figure out
how many positives there were in the minibatch.

At test time, we do not have access to ground-truth so the LocalizationLayer
produces nil for the ground-truth, and we want to run the language model and
box regression for all boxes.
--]]

function layer:__init()
  parent.__init(self)
  self.grad_features = torch.Tensor()
  self.grad_gt_features = torch.Tensor()
end

function layer:updateOutput(input)
  local features = input[1]
  local gt_features = input[2]
  if gt_features:nElement() == 0 then
    self.output = features
  else
    local P = gt_features:size(1)
    assert(P <= features:size(1), "Must have P <= N")
    self.output = features[{{1, P}}]
  end
  return self.output
end

function layer:updateGradInput(input, gradOutput)
  local features = input[1]
  local gt_features = input[2]
  self.grad_gt_features:resizeAs(gt_features):zero()
  if gt_features:nElement() == 0 then
    self.gradInput = {gradOutput, self.grad_gt_features}
  else
    local P = gt_features:size(1)
    self.grad_features:resizeAs(features):zero()
    self.grad_features[{{1, P}}]:copy(gradOutput)
    self.gradInput = {self.grad_features, self.grad_gt_features}
  end
  return self.gradInput
end

