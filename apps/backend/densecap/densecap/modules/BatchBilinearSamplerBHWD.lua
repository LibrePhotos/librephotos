local layer, parent = torch.class('nn.BatchBilinearSamplerBHWD', 'nn.Module')

--[[
  BatchBilinearSamplerBHWD efficiently performs bilinear sampling to pull out
  multiple patches from a single input image.

  Inputs:
  - inputImages: Tensor of shape (H, W, C)
  - grids: Tensor of shape (N, HH, WW, 2)

  Output:
  - Tensor of shape (N, HH, WW, C) which is the result of applying each
    sampling grid to the input image.

  The BilinearSamplerBHWD module provided by qassemoquab/stnbhwd expects a
  batch of images of shape (N, HH, WW, 2) and a batch of sampling grids of shape
  (N, H, W, C) and applies one sampling grid to each image. This gets tricky
  when we want to apply many sampling grids to a single input image.

  One strategy is to replicate the (H, W, C) input image to (N, H, W, C) and
  then use BilinearSamplerBHWD. This is the strategy used by
  NaiveBatchBilinearSamplerBHWD. While this produces the correct output, it uses
  a lot of memory. The forward pass is efficient, since the replicate operation
  simply adds a 0-stride axis to the tensor of input data. However the backward
  pass is slow, since the gradient of the replicated image data is a full
  (N, H, W, C) tensor. When we have N = 128, H = W = 64, C = 512
  (as might be the case for the last conv layer of VGG-16) this can take over
  1GB of graphics memory.

  To get around this problem, we notice that the backward pass of the replicate
  operator will collapse the (N, H, W, C) tensor of upstream gradients to
  (H, W, C) by summing out the first axis. We also notice that in the cuda
  kernel code that backs BilinearSamplerBHWD, the gradient of the input image
  data is only modified using the thread-safe atomicAdd primitive.

  This suggests the following efficient solution:

  Accept a (N, HH, WW, 2) batch of sampling grids and a single (H, W, C) input
  image. On the forward pass, expand the input image to (N, H, W, C) by
  prepending a 0-stride axis; now we can call into the BilinearSamplerBHWD
  forward kernel.

  On the backward pass, we also accept a (N, HH, WW, C) tensor of upstream
  gradients. We construct a (H, W, C) tensor for gradients of our input image,
  then create a view of these gradients of shape (N, H, W, C) by prepending a
  0-stride axis. We pass this view to the BilinearSamplerBHWD backward kernel,
  which will now implicitly sum out the first axis of the gradient tensor,
  writing it directly into the (H, W, C) tensor of image gradients.

  The unit tests for this code test for correctness by comparing against
  NaiveBatchBilinearSamplerBHWD, and also compare against the same to benchmark
  speed and memory usage. On my system, these benchmarks show a ~3.5x speedup
  to the backward pass compared to the naive version, and a ~35x reduction in
  memory usage for N=128, C=256, H=W=64.

  Much of this code was adapted from qassemoquab/stnbhwd, and this module calls
  into the efficient forward/backward kernels provided by qassemoquab/stnbhwd.
]]

function layer:__init()
  parent.__init(self)
  
  self.gradInput = {}
  self.inputImageView = torch.Tensor()
  self.gradInputImageView = torch.Tensor()
end


function layer:clearState()
  self.gradInput = {}
  self.output:set()
  self.inputImageView:set()
  self.gradInputImageView:set()
end


function layer:check(input, gradOutput)
  local inputImages = input[1]
  local grids = input[2]

  assert(inputImages:nDimension()==4)
  assert(grids:nDimension()==4)
  assert(inputImages:size(1)==grids:size(1)) -- batch
  assert(grids:size(4)==2) -- coordinates

  if gradOutput then
     assert(grids:size(1)==gradOutput:size(1))
     assert(grids:size(2)==gradOutput:size(2))
     assert(grids:size(3)==gradOutput:size(3))
  end
end

local function addOuterDim(t)
  local sizes = t:size()
  local newsizes = torch.LongStorage(sizes:size()+1)
  newsizes[1]=1
  for i=1,sizes:size() do
    newsizes[i+1]=sizes[i]
  end
  return t:view(newsizes)
end


function layer:updateOutput(input)
  -- inputImages should be C x H x W
  -- grids should be B x HH x WW x 2
  local inputImages, grids = input[1], input[2]
  
  assert(grids:dim() == 4)
  local B = grids:size(1)
  
  assert(inputImages:dim() == 3)
  local H, W, C = inputImages:size(1), inputImages:size(2), inputImages:size(3)
  self.inputImageView = addOuterDim(inputImages):expand(B, H, W, C)

  self:check{self.inputImageView, grids}
  self.output:resize(B, grids:size(2), grids:size(3), C)

  inputImages.nn.BilinearSamplerBHWD_updateOutput(self, self.inputImageView, grids, self.output)

  return self.output
end


function layer:updateGradInput(input, gradOutput)
  -- inputImages should be C x H x W
  -- grids should be B x HH x WW x 2
  -- gradOutput should be B x HH x WW x C
  local inputImages, grids = input[1], input[2]
  
  assert(grids:dim() == 4)
  local B = grids:size(1)
  
  assert(inputImages:dim() == 3)
  local H, W, C = inputImages:size(1), inputImages:size(2), inputImages:size(3)

  assert(gradOutput:dim() == 4)
  assert(gradOutput:size(1) == B and gradOutput:size(4) == C)

  local input = {inputImages, grids}

  self:check({self.inputImageView, grids}, gradOutput)
  gradInputImages = self.gradInput[1] or input[1].new()
  gradInputImages:resize(H, W, C):zero()
  gradGrids = self.gradInput[2] or input[2].new()
  gradGrids:resizeAs(grids):zero()
  self.gradInput = {gradInputImages, gradGrids}
  
  self.gradInputImageView = addOuterDim(gradInputImages)
  self.gradInputImageView = self.gradInputImageView:expand(B, H, W, C)
  
  inputImages.nn.BilinearSamplerBHWD_updateGradInput(
      self, self.inputImageView, grids, self.gradInputImageView,
      gradGrids, gradOutput)
   
  return self.gradInput
end

-------------------------------------------------------------------------------
-- NAIVE, deprecated version below
-------------------------------------------------------------------------------

local layer, parent = torch.class('nn.NaiveBatchBilinearSamplerBHWD', 'nn.Module')

--[[
  NaiveBatchBilinearSamplerBHWD performs bilinear sampling to pull out
  multiple patches from a single input image.

  Inputs:
  - inputImages: Tensor of shape (H, W, C)
  - grids: Tensor of shape (N, HH, WW, 2)

  Output:
  - Tensor of shape (N, HH, WW, C) which is the result of applying each
    sampling grid to the input image.

  This implementation is very naive and inefficient, and is mainly used
  to test the correctness of the more efficient implementation of the same
  module BatchBilinearSamplerBHWD, above.
  
--]]

function layer:__init()
  parent.__init(self)
  self.sampler = nn.BilinearSamplerBHWD()
  self.replicate = nil
  self.replicate_out = nil
end

function layer:updateOutput(input)
  local feats, grids = input[1], input[2]
  local B = grids:size(1)
  self.replicate = nn.Replicate(grids:size(1)):type(feats:type())
  self.replicate_out = self.replicate:forward(feats)
  self.output = self.sampler:forward{self.replicate_out, grids}
  return self.output
end

function layer:updateGradInput(input, gradOutput)
  local feats, grids = input[1], input[2]
  local grad_sampler_in = self.sampler:backward(
                                {self.replicate_out, grids},
                                gradOutput)
  local grad_feats = self.replicate:backward(feats, grad_sampler_in[1])
  self.gradInput = {grad_feats, grad_sampler_in[2]}
  return self.gradInput
end

