local CrossEntropyCriterion, Criterion = torch.class('nn.OurCrossEntropyCriterion', 'nn.Criterion')

--[[
This is a copy of CrossEntropyCriterion from torch/nn, except that the inputs and
targets are not squeezed. This was giving strange results for single-element
minibatches.
--]]

function CrossEntropyCriterion:__init(weights)
   Criterion.__init(self)
   self.lsm = nn.LogSoftMax()
   self.nll = nn.ClassNLLCriterion(weights)
end

function CrossEntropyCriterion:updateOutput(input, target)
   --input = input:squeeze()
   --target = type(target) == 'number' and target or target:squeeze()
   self.lsm:updateOutput(input)
   self.nll:updateOutput(self.lsm.output, target)
   self.output = self.nll.output
   return self.output
end

function CrossEntropyCriterion:updateGradInput(input, target)
   local size = input:size()
   --input = input:squeeze()
   --target = type(target) == 'number' and target or target:squeeze()
   self.nll:updateGradInput(self.lsm.output, target)
   self.lsm:updateGradInput(input, self.nll.gradInput)
   self.gradInput:view(self.lsm.gradInput, size)
   return self.gradInput
end

return nn.CrossEntropyCriterion
