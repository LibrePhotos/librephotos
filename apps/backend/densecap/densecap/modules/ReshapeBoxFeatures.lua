local layer, parent = torch.class('nn.ReshapeBoxFeatures', 'nn.Module')

--[[
Input a tensor of shape N x (D * k) x H x W
Reshape and permute to output a tensor of shape N x (k * H * W) x D 
--]]

function layer:__init(k)
  parent.__init(self)
  self.k = k
  self.input_perm = torch.Tensor()
  self.gradInput_perm = torch.Tensor()
end


function layer:clearState()
  self.input_perm:set()
  self.gradInput_perm:set()
  self.output:set()
  self.gradInput:set()
end


function layer:updateOutput(input)
  local N, H, W = input:size(1), input:size(3), input:size(4)
  local D = input:size(2) / self.k
  local k = self.k
  -- print(N, k, H, W, D)
  self.input_perm:resize(N, k, H, W, D)
  self.input_perm:copy(input:view(N, k, D, H, W):permute(1, 2, 4, 5, 3))
  self.output = self.input_perm:view(N, k * H * W, D)
  return self.output
end


function layer:updateGradInput(input, gradOutput)
  local N, H, W = input:size(1), input:size(3), input:size(4)
  local D = input:size(2) / self.k
  local k = self.k
  self.gradInput_perm:resize(N, k, D, H, W)
  self.gradInput_perm:copy(gradOutput:view(N, k, H, W, D):permute(1, 2, 5, 3, 4))
  self.gradInput = self.gradInput_perm:view(N, k * D, H, W)
  return self.gradInput
end
