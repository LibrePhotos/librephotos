require 'densecap.modules.BoxSampler'

local helper, parent = torch.class('nn.BoxSamplerHelper', 'nn.Module')


function helper:__init(options)
  parent.__init(self)
  if options and options.box_sampler then
    -- Optional dependency injection for testing
    self.box_sampler = options.box_sampler
  else
    self.box_sampler = nn.BoxSampler(options)
  end
  
  self.output = {{torch.Tensor()}, {torch.Tensor()}, {torch.Tensor()}}
  self.gradInput = {torch.Tensor()}

  self.num_pos, self.num_neg = nil, nil
  self.pos_input_idx = nil
  self.pos_target_idx = nil
  self.neg_input_idx = nil
end


function helper:setBounds(bounds)
  -- Just forward to the underlying sampler
  self.box_sampler:setBounds(bounds)
end


--[[
  Input:
  
  List of two lists. The first list contains data about the input boxes,
  and the second list contains data about the target boxes.

  The first element of the first list is input_boxes, a Tensor of shape (N, B1, 4)
  giving coordinates of the input boxes in (xc, yc, w, h) format.

  All other elements of the first list are tensors of shape (N, B1, Di) parallel to
  input_boxes; Di can be different for each element.

  The first element of the second list is target_boxes, a Tensor of shape (N, B2, 4)
  giving coordinates of the target boxes in (xc, yc, w, h) format.

  All other elements of the second list are tensors of shape (N, B2, Dj) parallel
  to target_boxes; Dj can be different for each Tensor.

  
  Returns a list of three lists:

  The first list contains data about positive input boxes. The first element is of
  shape (P, 4) and contains coordinates of positive boxes; the other elements
  correspond to the additional input data about the input boxes; in particular the
  ith element has shape (P, Di).

  The second list contains data about target boxes corresponding to positive
  input boxes. The first element is of shape (P, 4) and contains coordinates of
  target boxes corresponding to sampled positive input boxes; the other elements
  correspond to the additional input data about the target boxes; in particular the
  jth element has shape (P, Dj).

  The third list contains data about negative input boxes. The first element is of
  shape (M, 4) and contains coordinates of negative input boxes; the other elements
  correspond to the additional input data about the input boxes; in particular the
  ith element has shape (M, Di).
--]]
function helper:updateOutput(input)
  -- Unpack the input
  local input_data = input[1]
  local target_data = input[2]
  local input_boxes = input_data[1]
  local target_boxes = target_data[1]
  local N = input_boxes:size(1)
  assert(N == 1, 'Only minibatches of 1 are supported')

  -- Run the sampler to get the indices of the positive and negative boxes
  local idxs = self.box_sampler:forward{input_boxes, target_boxes}
  self.pos_input_idx = idxs[1]
  self.pos_target_idx = idxs[2]
  self.neg_input_idx = idxs[3]

  -- Resize the output. We need to allocate additional tensors for the
  -- input data and target data, then resize them to the right size.
  self.num_pos = self.pos_input_idx:size(1)
  self.num_neg = self.neg_input_idx:size(1)
  for i = 1, #input_data do
    -- The output tensors for additional data will be lazily instantiated
    -- on the first forward pass, which is probably after the module has been
    -- cast to the right datatype, so we make sure the new Tensors have the
    -- same type as the corresponding elements of the input.
    local dtype = input_data[i]:type()
    if #self.output[1] < i then
      table.insert(self.output[1], torch.Tensor():type(dtype))
    end
    if #self.output[3] < i then
      table.insert(self.output[3], torch.Tensor():type(dtype))
    end
    local D = input_data[i]:size(3)
    self.output[1][i]:resize(self.num_pos, D)
    self.output[3][i]:resize(self.num_neg, D)
  end
  for i = 1, #target_data do
    local dtype = target_data[i]:type()
    if #self.output[2] < i then
      table.insert(self.output[2], torch.Tensor():type(dtype))
    end
    local D = target_data[i]:size(3)
    self.output[2][i]:resize(self.num_pos, D)
  end

  -- Now use the indicies to actually copy data from inputs to outputs
  for i = 1, #input_data do
    self.output[1][i]:index(input_data[i], 2, self.pos_input_idx)
    self.output[3][i]:index(input_data[i], 2, self.neg_input_idx)
    -- The call to index adds an extra dimension at the beginning for batch
    -- size, but since its a singleton we just squeeze it out
    local D = input_data[i]:size(3)
    self.output[1][i] = self.output[1][i]:view(self.num_pos, D)
    self.output[3][i] = self.output[3][i]:view(self.num_neg, D)
  end
  for i = 1, #target_data do
    self.output[2][i]:index(target_data[i], 2, self.pos_target_idx)
    local D = target_data[i]:size(3)
    self.output[2][i] = self.output[2][i]:view(self.num_pos, D)
  end

  return self.output
end


--[[

Arguments:
  - input: Same as last call to updateOutput.
  - gradOutput: A list of two elements, giving the gradients of output[1] and output[3].

Returns:
A single list, giving the gradients of the loss with respect to the input data
(the first argument to updateOutput)
--]]
function helper:updateGradInput(input, gradOutput)
  -- Unpack the input and gradOutput
  local input_data = input[1]
  local target_data = input[2]
  local input_boxes = input_data[1]
  local target_boxes = target_data[1]
  local N = input_boxes:size(1)
  local B1, B2 = input_boxes:size(2), target_boxes:size(2)
  assert(N == 1, 'Only minibatches of 1 are supported')
  
  -- Resize the gradInput. It should be the same size as input_data.
  -- As in the forward pass, we need to worry about data types since
  -- Tensors are lazily instantiated here.
  for i = 1, #input_data do
    local dtype = input_data[i]:type()
    if #self.gradInput < i then
      table.insert(self.gradInput, torch.Tensor():type(dtype))
    end
    self.gradInput[i]:resizeAs(input_data[i])
  end

  -- Copy the gradients from gradOutput to self.input
  -- This assumes that there is no overlap between the positive and negative samples
  -- coming out of the BoxSampler, which should always be true.
  for i = 1, #input_data do
    self.gradInput[i]:zero()
    
    if gradOutput[1][i] then
      local v1 = gradOutput[1][i]:view(1, self.num_pos, -1)
      self.gradInput[i]:indexCopy(2, self.pos_input_idx, v1)
    end

    if gradOutput[2][i] then
      local v2 = gradOutput[2][i]:view(1, self.num_neg, -1)
      self.gradInput[i]:indexCopy(2, self.neg_input_idx, v2)
    end
    
  end

  return self.gradInput
end
