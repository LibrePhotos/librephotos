require 'nn'

local crit, parent = torch.class('nn.LogisticCriterion', 'nn.Criterion')

--[[
One-vs-all logistic loss; each example has a single positive class.

On the forward pass we take:
- input: Tensor of shape (N, C) giving scores for C classes for each
  of N examples.
- target: LongTensor of shape (N) giving labels for each of the N
  examples; each element is an integer in the range [0, C] with the
  interpretation that target[i] = 0 means that input[i] is a negative
  example for all classes; if target[i] = c > 0 then input[i] is a positive
  example for class c and a negative example for all other classes.

The amounts to evaluating the binary logistic loss for each element of the
(N, C) array of scores. For an element x = scores[{i, j}], its binary label
is y = 1 if target[i] = j and y = 0 otherwise. The binary logistic loss is
given by:

loss(x, y) = log(1 + exp(-x))        if y == 1
             log(1 + exp(-x)) + x    if y == 0

You can derive this as KL(target, predicted) where target and predicted are
distributions over two classes (positive and negative), the target
distribution is

P(pos) = y
P(neg) = 1 - y

and the predicted distribution is

P(pos) = 1 / (1 + exp(-x))
P(neg) = exp(-x) / (1 + exp(-x)))

To improve numeric stability, we make use of the fact that for all a,

log(1 + exp(-x)) = log(exp(a) + exp(a - x)) - a

In practice we choose a = min(0, x) to make sure that all exponents
are negative; this way we won't have overflow resulting in inf, but
we may have underflow resulting in 0 which is preferable.
--]]

function crit:__init()
  parent.__init(self)
  self.offsets = torch.Tensor()
  self.buffer = torch.Tensor()
  self.log_den = torch.Tensor()
  self.losses = torch.Tensor()
  self.mask = torch.ByteTensor()

  -- some other variables needed to handle target = 0
  self.target_nonzero = torch.LongTensor()
  self.target_zero_mask = torch.ByteTensor()
end


function crit:clearState()
  self.offsets:set()
  self.buffer:set()
  self.log_den:set()
  self.losses:set()
  self.mask:set()
  self.target_nonzero:set()
  self.target_zero_mask:set()
  self.gradInput:set()
end


function crit:updateOutput(input, target)
  --[[
  Inputs:
  - input: N x C tensor of class scores
  - target: N LongTensor giving ground-truth for elements of inputs;
            each element should be an integer in the range [0, C];
            if target[i] == 0 then input[i] should be negative for all classes.
  --]]
  self.offsets:resizeAs(input)
  self.buffer:resizeAs(input)
  self.log_den:resizeAs(input)
  self.losses:resizeAs(input)

  -- offsets = a = min(0, x)
  self.offsets:cmin(input, 0)

  -- buffer = exp(a - x)
  self.buffer:add(self.offsets, -1, input):exp()

  -- log(exp(a) + exp(a-x)) - a
  self.log_den:exp(self.offsets):add(self.buffer):log():add(-1, self.offsets)

  -- We want to use target to scatter into mask below, but this will crash for
  -- elements where target = 0; to get around this we store in target_nonzero a
  -- copy of target with 0 replaced by 1, and also keep a mask of the places where
  -- this happened; this will make the scatter work below, but we will then have to
  -- use the mask to "undo" the scatter into the rows where target = 0.
  self.target_nonzero = self.target_nonzero:long()
  self.target_nonzero:cmax(target, 1)
  self.target_zero_mask = torch.eq(target, 0)

  -- mask picks out places where y = 0
  self.mask = self.mask:resize(#input):byte():fill(1)
  
  --[[
  torch.save('foo.t7', {
    mask = self.mask,
    idx = self.target_nonzero:view(-1, 1):long()
  })
  --]]
  self.mask:scatter(2, self.target_nonzero:view(-1, 1):long(), 0)
  self.mask:maskedFill(self.target_zero_mask:view(-1, 1):expandAs(input), 1)

  self.losses:copy(self.log_den)
  self.losses[self.mask] = self.losses[self.mask]:add(input[self.mask])

  self.losses:div(input:nElement())
  self.output = torch.sum(self.losses)
  return self.output
end


function crit:updateGradInput(input, target)
  self.gradInput:resizeAs(input)
  self.gradInput:add(input, self.log_den):mul(-1):exp():mul(-1)
  self.gradInput[self.mask] = self.gradInput[self.mask]:add(1)
  self.gradInput:div(input:nElement())
  return self.gradInput
end
