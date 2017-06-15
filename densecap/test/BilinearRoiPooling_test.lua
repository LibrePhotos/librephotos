require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

require 'densecap.modules.BilinearRoiPooling.lua'


local tests = {}
local tester = torch.Tester()


function tester:assertSizeIs(x, dims)
  self:asserteq(x:dim(), #dims)
  for i = 1, #dims do
    self:asserteq(x:size(i), dims[i])
  end
end


-- Simple test to make sure the shapes are correct,
-- even when we have different numbers of boxes in
-- different forward passes.
local function shapeTestFactory(dtype)
  return function()
    local C, H, W = 64, 28, 29
    local HH, WW = 8, 7
    local B = 10

    local boxes = torch.randn(B, 4):type(dtype)
    local feats = torch.randn(C, H, W):type(dtype)

    local mod = nn.BilinearRoiPooling(HH, WW):type(dtype)
    mod:setImageSize(H, W)
    local out = mod:forward{feats, boxes}
    tester:assertSizeIs(out, {B, C, HH, WW})

    -- Do it again, but change the number of boxes
    B = 13
    local boxes = torch.randn(B, 4):type(dtype)
    mod:setImageSize(H, W)
    out = mod:forward{feats, boxes}
    tester:assertSizeIs(out, {B, C, HH, WW})

    B = 7
    local boxes = torch.randn(B, 4):type(dtype)
    mod:setImageSize(H, W)
    out = mod:forward{feats, boxes}
    tester:assertSizeIs(out, {B, C, HH, WW})
  end
end

tests.floatShapeTest = shapeTestFactory('torch.FloatTensor')
tests.doubleShapeTest = shapeTestFactory('torch.DoubleTensor')
tests.cudaShapeTest = shapeTestFactory('torch.CudaTensor')


local function timeTestFactory(dtype)
  local function f()
    -- Size of last convolutional feature map
    local C, H, W = 512, 32, 32
    
    -- Expected size of convolutional feature map for fully-connected layers
    local HH, WW = 7, 7
    
    local B = 128
    
    local feats = torch.randn(C, H, W):type(dtype)
    local boxes = torch.randn(B, 4):type(dtype)
    
    local mod = nn.BilinearRoiPooling(HH, WW):type(dtype):setImageSize(H, W)
    
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local timer = torch.Timer()
    local out = mod:forward{feats, boxes}
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local forward_time = timer:time().real
    
    local dout = torch.randn(#out):type(dtype)
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    timer:reset()
    local din = mod:backward({feats, boxes}, dout)
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local backward_time = timer:time().real
    
    print('')
    local msg1 = 'Sampling %d boxes to %dx%d from input map of size %dx%dx%d'
    local msg2 = 'with dtype="%s" took %fs forward, %fs backward'
    print(string.format(msg1, B, HH, WW, C, H, W))
    print(string.format(msg2, dtype, forward_time, backward_time))
  end
  return f
end

tests.floatTimeTest = timeTestFactory('torch.FloatTensor')
tests.doubleTimeTest = timeTestFactory('torch.DoubleTensor')
tests.cudaTimeTest = timeTestFactory('torch.CudaTensor')


function tests.cudaMemoryTest()
    -- Size of last convolutional feature map
    local C, H, W = 512, 64, 64

    -- Expected size of convolutional feature map for fully-connected layers
    local HH, WW = 7, 7

    local B = 256

    local feats = torch.randn(C, H, W):cuda()
    local boxes = torch.randn(B, 4):cuda()
  
    for i = 1, 5 do collectgarbage() end
    cutorch.synchronize()
    local device = cutorch.getDevice()
    local free_before, total = cutorch.getMemoryUsage(device)
  
    local mod = nn.BilinearRoiPooling(HH, WW):setImageSize(H, W):cuda()
    local out = mod:forward{feats, boxes}
    local dout = torch.randn(#out):cuda()
    local din = mod:backward({feats, boxes}, dout)
    
    for i = 1, 5 do collectgarbage() end
    cutorch.synchronize()
    local device = cutorch.getDevice()
    local free_after, total = cutorch.getMemoryUsage(device)
  
    local used_mb = (free_before - free_after) / 1024 / 1024
    print('')
    local msg1 = 'Resizing %d RoIs to %dx%d from a %dx%dx%d feature map'
    local msg2 = 'took %.2f MB of GPU memory'
    print(string.format(msg1, B, HH, WW, C, H, W))
    print(string.format(msg2, used_mb))
end


tester:add(tests)
tester:run()
