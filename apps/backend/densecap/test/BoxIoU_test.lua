require 'torch'
require 'nn'
require 'cutorch'
require 'cunn'

require 'densecap.modules.BoxIoU'


local tests = {}
local tester = torch.Tester()


function tests.simpleTest()
  local N, B1, B2 = 1, 1, 1
  local boxes1 = torch.Tensor(N, B1, 4)
  local boxes2 = torch.Tensor(N, B2, 4)

  boxes1[{1, 1}] = torch.Tensor({10, 10, 10, 10})
  boxes2[{1, 1}] = torch.Tensor({15, 15, 10, 10})

  local mod = nn.BoxIoU()
  local iou = mod:forward({boxes1, boxes2})
  tester:assertTensorEq(iou, torch.Tensor({25 / 175}), 1e-10)
end


function tests.noOverlapTest()
  local N, B1, B2 = 1, 1, 1
  local boxes1 = torch.Tensor(N, B1, 4)
  local boxes2 = torch.Tensor(N, B2, 4)
  
  boxes1[{1, 1}] = torch.Tensor({10, 10, 5, 5})
  boxes2[{1, 1}] = torch.Tensor({15, 15, 5, 5})
  
  local mod = nn.BoxIoU()
  local iou = mod:forward({boxes1, boxes2})
  tester:assertTensorEq(iou, torch.Tensor({0}), 1e-10)
end

-- I drew this example out on graph paper
function tests.multipleBoxesTest()
  local N, B1, B2 = 1, 2, 3
  local boxes1 = torch.Tensor(N, B1, 4)
  local boxes2 = torch.Tensor(N, B2, 4)
  
  boxes1[{1, 1}] = torch.Tensor({2, 4, 2, 6})
  boxes1[{1, 2}] = torch.Tensor({5, 7.5, 2, 5})
  
  boxes2[{1, 1}] = torch.Tensor({5, 8, 4, 2})
  boxes2[{1, 2}] = torch.Tensor({4.5, 4.5, 5, 3})
  boxes2[{1, 3}] = torch.Tensor({4.5, 0, 5, 4})
  
  local mod = nn.BoxIoU()
  local iou = mod:forward({boxes1, boxes2})
  
  local iou_expected = torch.Tensor(N, B1, B2)
  iou_expected[{1, 1}] = torch.Tensor({0, 3 / 24, 1 / 31})
  iou_expected[{1, 2}] = torch.Tensor({4 / 14, 2 / 23, 0})
  
  tester:assertTensorEq(iou, iou_expected, 1e-8)
end


function tests.minibatchTest()
  local N, B1, B2 = 2, 2, 3
  local boxes1 = torch.Tensor(N, B1, 4)
  local boxes2 = torch.Tensor(N, B2, 4)
  
  boxes1[{1, 1}] = torch.Tensor({2, 4, 2, 6})
  boxes1[{1, 2}] = torch.Tensor({5, 7.5, 2, 5})
  
  boxes2[{1, 1}] = torch.Tensor({5, 8, 4, 2})
  boxes2[{1, 2}] = torch.Tensor({4.5, 4.5, 5, 3})
  boxes2[{1, 3}] = torch.Tensor({4.5, 0, 5, 4})


  boxes1[{2, 1}] = torch.Tensor({4, 2, 2, 6})
  boxes1[{2, 2}] = torch.Tensor({6, -2, 2, 2})

  boxes2[{2, 1}] = torch.Tensor({4, 2, 4, 2})
  boxes2[{2, 2}] = torch.Tensor({4.5, -1, 3, 2})
  boxes2[{2, 3}] = torch.Tensor({6, -2, 4, 4})
  
  local mod = nn.BoxIoU()
  local iou = mod:forward({boxes1, boxes2})
  
  local iou_expected = torch.Tensor(N, B1, B2)
  iou_expected[{1, 1}] = torch.Tensor({0, 3 / 24, 1 / 31})
  iou_expected[{1, 2}] = torch.Tensor({4 / 14, 2 / 23, 0})
  iou_expected[{2, 1}] = torch.Tensor({1 / 4, 1 / 8, 1 / 27})
  iou_expected[{2, 2}] = torch.Tensor({0, 1 / 9, 1 / 4})

  tester:assertTensorEq(iou, iou_expected, 1e-8)
end


local function timeTestFactory(dtype, N, B1, B2)
  local function f()
    local boxes1 = torch.randn(N, B1, 4):type(dtype)
    local boxes2 = torch.randn(N, B2, 4):type(dtype)

    local mod = nn.BoxIoU():type(dtype)

    local timer = torch.Timer()
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    timer:reset()
    local iou = mod:forward({boxes1, boxes2})
    if dtype == 'torch.CudaTensor' then cutorch.synchronize() end
    local time = timer:time().real

    print('')
    local msg = 'Running %d x %d x %d as %s took %f'
    print(string.format(msg, N, B1, B2, dtype, time))                
  end
  return f
end


tests.floatTimeTest = timeTestFactory('torch.FloatTensor', 1, 20000, 50)
tests.doubleTimeTest = timeTestFactory('torch.DoubleTensor', 1, 20000, 50)
tests.cudaTimeTest = timeTestFactory('torch.CudaTensor', 1, 20000, 50)


tester:add(tests)
tester:run()
