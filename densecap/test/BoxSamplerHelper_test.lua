require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

require 'densecap.modules.BoxSamplerHelper'

local tests = {}
local tester = torch.Tester()


-- Check that a tensor has a specific size (list of ints)
function tester:assertTensorSizeEq(tensor, size)
  self:asserteq(tensor:nDimension(), #size)
  for i = 1, #size do
    self:asserteq(tensor:size(i), size[i])
  end
end


local function fakeBoxSampler(idxs)
  local fake = {}
  function fake:forward(input)
    return idxs
  end
  return fake
end


function tests.simpleTest()
  print('')
  local N, B1, B2 = 1, 7, 4
  local input_dims = {4, 5, 3}
  local target_dims = {4, 1}
  
  local input_data, target_data = {}, {}
  for i = 1, #input_dims do
    local D = input_dims[i]
    table.insert(input_data, torch.randn(N, B1, D))
  end
  for i = 1, #target_dims do
    local D = target_dims[i]
    table.insert(target_data, torch.randn(N, B2, D))
  end
  
  local pos_input_idx = torch.LongTensor{7, 2, 3}
  local pos_target_idx = torch.LongTensor{1, 2, 1}
  local neg_input_idx = torch.LongTensor{5, 1}
  local sampler_idxs = {pos_input_idx, pos_target_idx, neg_input_idx}
  local box_sampler = fakeBoxSampler(sampler_idxs)

  -- First test the forward pass
  
  local mod = nn.BoxSamplerHelper{box_sampler=box_sampler}
  local input = {input_data, target_data}
  local output = mod:forward(input)

  -- Check that input_pos and input_neg outputs are correct
  for i = 1, #input_dims do
    -- make sure size is correct for pos input data
    tester:assertTensorSizeEq(output[1][i], {pos_input_idx:nElement(), input_dims[i]})
    tester:assertTensorSizeEq(output[3][i], {neg_input_idx:nElement(), input_dims[i]})
    
    -- pos input data
    for j = 1, pos_input_idx:nElement() do
      tester:assertTensorEq(output[1][i][j], input_data[i][{1, pos_input_idx[j]}], 0)
    end
    
    -- neg input data
    for j = 1, neg_input_idx:nElement() do
      tester:assertTensorEq(output[3][i][j], input_data[i][{1, neg_input_idx[j]}], 0)
    end
  end
  
  -- Check that target data outputs are correct
  for i = 1, #target_dims do
    tester:assertTensorSizeEq(output[2][i], {pos_target_idx:nElement(), target_dims[i]})
    for j = 1, pos_target_idx:nElement() do
      tester:assertTensorEq(output[2][i][j], target_data[i][{1, pos_target_idx[j]}], 0)
    end
  end
  
  -- Now test the backward pass
  
  local gradOutput = {{}, {}}
  for i = 1, #output[1] do
    table.insert(gradOutput[1], torch.randn(output[1][i]:size()))
  end
  for i = 1, #output[3] do
    table.insert(gradOutput[2], torch.randn(output[3][i]:size()))
  end
  
  local gradInput = mod:backward({input_data, target_data}, gradOutput)
  
  for i = 1, #input_dims do
    tester:assertTensorSizeEq(gradInput[i], input[1][i]:size())
    for j = 1, pos_input_idx:nElement() do
      tester:assertTensorEq(gradInput[i][{1, pos_input_idx[j]}], gradOutput[1][i][j], 0)
    end
    for j = 1, neg_input_idx:nElement() do
      tester:assertTensorEq(gradInput[i][{1, neg_input_idx[j]}], gradOutput[2][i][j], 0)
    end
  end
end

tester:add(tests)
tester:run()
