require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

require 'stn'
require 'densecap.modules.BatchBilinearSamplerBHWD'

local tests = {}
local tester = torch.Tester()


-- Test that BatchBilinearSamplerBHWD and NaiveBatchBilinearSamplerBHWD
-- compute the same outputs and gradients.
local function naiveComparisonFactory(dtype)
  return function()
    local B = 10
    local C, H, W = 128, 32, 33
    local HH, WW = 7, 8
    
    local agg = nn.AffineGridGeneratorBHWD(HH, WW):type(dtype)
    local sampler_naive = nn.NaiveBatchBilinearSamplerBHWD():type(dtype)
    local sampler = nn.BatchBilinearSamplerBHWD():type(dtype)
    
    local boxes = torch.randn(B, 2, 3):mul(0.1)
    boxes[{{}, 1, 1}]:add(1)
    boxes[{{}, 2, 2}]:add(1)
    boxes = boxes:type(dtype)
    
    local feats = torch.randn(H, W, C):type(dtype)
    local grids = agg:forward(boxes)
    
    local out = sampler:forward{feats, grids}
    local out_naive = sampler_naive:forward{feats, grids}
    
    tester:assertTensorEq(out, out_naive, 1e-6)

    local dout = torch.randn(#out):typeAs(out)
    local din = sampler:backward({feats, grids}, dout)
    local din_naive = sampler_naive:backward({feats, grids}, dout)

    for k, v in pairs(din) do
      tester:assertTensorEq(din[k], din_naive[k], 1e-6)
    end
  end
end

tests.floatNaiveComparison = naiveComparisonFactory('torch.FloatTensor')
tests.doubleNaiveComparison = naiveComparisonFactory('torch.DoubleTensor')
tests.cudaNaiveComparison = naiveComparisonFactory('torch.CudaTensor')


local function speedComparisonFactory(dtype)
  return function()
    local B = 128
    local C, H, W = 512, 32, 32
    local HH, WW = 7, 7
    
    local agg = nn.AffineGridGeneratorBHWD(HH, WW):type(dtype)
    local sampler_naive = nn.NaiveBatchBilinearSamplerBHWD():type(dtype)
    local sampler = nn.BatchBilinearSamplerBHWD():type(dtype)
    
    local boxes = torch.randn(B, 2, 3):mul(0.1)
    boxes[{{}, 1, 1}]:add(1)
    boxes[{{}, 2, 2}]:add(1)
    boxes = boxes:type(dtype)
    
    local feats = torch.randn(H, W, C):type(dtype)
    local grids = agg:forward(boxes)

    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local timer = torch.Timer()
    local out = sampler:forward{feats, grids}
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local forward_time = timer:time().real
    
    timer:reset()
    local out_naive = sampler_naive:forward{feats, grids}
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local forward_time_naive = timer:time().real

    local dout = torch.randn(#out):typeAs(out)
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end

    timer:reset()
    local din = sampler:backward({feats, grids}, dout)
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local backward_time = timer:time().real

    timer:reset()
    local din_naive = sampler_naive:backward({feats, grids}, dout)
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local backward_time_naive = timer:time().real

    local msg1 = 'forward: %s naive, %s fast (%.2fx faster)'
    local msg2 = 'backward: %s naive, %s fast (%.2fx faster)'
    print('')
    local f_speedup = forward_time_naive / forward_time
    print(string.format(msg1, forward_time_naive, forward_time, f_speedup))
    local b_speedup = backward_time_naive / backward_time
    print(string.format(msg2, backward_time_naive, backward_time, b_speedup))
  end
end

tests.floatSpeedComparison = speedComparisonFactory('torch.FloatTensor')
tests.doubleSpeedComparison = speedComparisonFactory('torch.DoubleTensor')
tests.cudaSpeedComparison = speedComparisonFactory('torch.CudaTensor')


function tests.cudaMemoryComparison()
    local dtype = 'torch.CudaTensor'
    local B = 128
    local C, H, W = 512, 64, 64
    local HH, WW = 7, 7
    
    local agg = nn.AffineGridGeneratorBHWD(HH, WW):type(dtype)
    local sampler_naive = nn.NaiveBatchBilinearSamplerBHWD():type(dtype)
    local sampler_batch = nn.BatchBilinearSamplerBHWD():type(dtype)
    
    local boxes = torch.randn(B, 2, 3):mul(0.1)
    boxes[{{}, 1, 1}]:add(1)
    boxes[{{}, 2, 2}]:add(1)
    boxes = boxes:type(dtype)
    
    local feats = torch.randn(H, W, C):type(dtype)
    local grids = agg:forward(boxes)

    local function checkMemory(sampler)
      for i = 1, 3 do collectgarbage() end
      local device = cutorch.getDevice()
      local free_start, total = cutorch.getMemoryUsage(device)

      local out = sampler:forward{feats, grids}
      local dout = torch.randn(#out):cuda()
      local din = sampler:backward({feats, grids}, dout)

      for i = 1, 3 do collectgarbage() end
      cutorch.synchronize()
      local device = cutorch.getDevice()
      local free_end, total = cutorch.getMemoryUsage(device)

      local used_bytes = free_start - free_end
      return used_bytes
    end

    local naive_memory = checkMemory(sampler_naive)
    local batch_memory = checkMemory(sampler_batch)

    local naive_mb = naive_memory / 1024 / 1024
    local batch_mb = batch_memory / 1024 / 1024

    print('')
    local msg = 'Naive used %.2f MB, batch used %.2f MB (%.2fx reduction)'
    print(string.format(msg, naive_mb, batch_mb, naive_mb / batch_mb))
end

tester:add(tests)
tester:run()

