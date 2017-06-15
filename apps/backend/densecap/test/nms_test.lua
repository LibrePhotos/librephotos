require 'torch'
require 'cutorch'

local box_utils = require 'densecap.box_utils'

local tests = {}
local tester = torch.Tester()

function test1Factory(dtype)
  local function f()
    local N = 7
    local boxes = torch.Tensor(N, 5)
    local coords = boxes[{{}, {1, 4}}]
    local scores = boxes[{{}, 5}]

    boxes[{1, {}}] = torch.Tensor({-12, 3, -7, 9, 1})
    boxes[{2, {}}] = torch.Tensor({-9, 7, -4, 13, 2})
    boxes[{3, {}}] = torch.Tensor({-8, 8, -3, 14, 3})
    boxes[{4, {}}] = torch.Tensor({3.5, 4.5, 8.5, 12.5, 4})
    boxes[{5, {}}] = torch.Tensor({-6, -6, -1, -1, 5})
    boxes[{6, {}}] = torch.Tensor({4, 5, 9, 13, 6})
    boxes[{7, {}}] = torch.Tensor({4.5, 5.5, 9.5, 13.5, 7})

    boxes = boxes:type(dtype)
    
    local idx = box_utils.nms(boxes, 0.7)
    local expected_idx = torch.LongTensor{7, 5, 4, 3, 2, 1}
    tester:assertTensorEq(idx, expected_idx, 0)
  end
  return f
end

tests.test1Float = test1Factory('torch.FloatTensor')
tests.test1Double = test1Factory('torch.DoubleTensor')
tests.test1Cuda = test1Factory('torch.CudaTensor')

-- Same boxes as previous case, but lower iou threshold means fewer boxes
function test2Factory(dtype)
  local function f()
    local N = 7
    local boxes = torch.Tensor(N, 5)
    local coords = boxes[{{}, {1, 4}}]
    local scores = boxes[{{}, 5}]

    boxes[{1, {}}] = torch.Tensor({-12, 3, -7, 9, 1})
    boxes[{2, {}}] = torch.Tensor({-9, 7, -4, 13, 2})
    boxes[{3, {}}] = torch.Tensor({-8, 8, -3, 14, 3})
    boxes[{4, {}}] = torch.Tensor({3.5, 4.5, 8.5, 12.5, 4})
    boxes[{5, {}}] = torch.Tensor({-6, -6, -1, -1, 5})
    boxes[{6, {}}] = torch.Tensor({4, 5, 9, 13, 6})
    boxes[{7, {}}] = torch.Tensor({4.5, 5.5, 9.5, 13.5, 7})

    boxes = boxes:type(dtype)
    
    local idx = box_utils.nms(boxes, 0.5)
    local expected_idx = torch.LongTensor{7, 5, 3, 1}
    tester:assertTensorEq(idx, expected_idx, 0)
  end
  return f
end

tests.test2Float = test2Factory('torch.FloatTensor')
tests.test2Double = test2Factory('torch.DoubleTensor')
tests.test2Cuda = test2Factory('torch.CudaTensor')

-- Same boxes as above, but different scores mean we select in
-- a different order; this can not only change the order of the
-- returned boxes but can also change the number of returned boxes.
function test3Factory(dtype)
  local function f()
    local N = 7
    local boxes = torch.Tensor(N, 5)
    local coords = boxes[{{}, {1, 4}}]
    local scores = boxes[{{}, 5}]

    boxes[{1, {}}] = torch.Tensor({-12, 3, -7, 9, 2.5})
    boxes[{2, {}}] = torch.Tensor({-9, 7, -4, 13, 2})
    boxes[{3, {}}] = torch.Tensor({-8, 8, -3, 14, 3})
    boxes[{4, {}}] = torch.Tensor({3.5, 4.5, 8.5, 12.5, 4})
    boxes[{5, {}}] = torch.Tensor({-6, -6, -1, -1, 5})
    boxes[{6, {}}] = torch.Tensor({4, 5, 9, 13, 10})
    boxes[{7, {}}] = torch.Tensor({4.5, 5.5, 9.5, 13.5, 7})

    boxes = boxes:type(dtype)
    
    local idx = box_utils.nms(boxes, 0.7)
    local expected_idx = torch.LongTensor{6, 5, 3, 1, 2}
    tester:assertTensorEq(idx, expected_idx, 0)
  end
  return f
end

tests.test3Float = test3Factory('torch.FloatTensor')
tests.test3Double = test3Factory('torch.DoubleTensor')
tests.test3Cuda = test3Factory('torch.CudaTensor')

function speedTestFactory(dtype, N, M)
  local function f()
    local boxes = torch.randn(N, 5):type(dtype)
    cutorch.synchronize()
    local timer = torch.Timer()
    print('')
    local idx = box_utils.nms(boxes, 0.5, M)
    cutorch.synchronize()
    local time = timer:time().real
    if M then
      local msg = 'Picking %d boxes from %d as %s took %f'
      print(string.format(msg, M, N, dtype, time))
    else
      local msg = 'Running with %d boxes as %s took %f'
      print(string.format(msg, N, dtype, time))
    end
  end
  return f
end

tests.floatSpeedTest = speedTestFactory('torch.FloatTensor', 20000)
tests.doubleSpeedTest = speedTestFactory('torch.DoubleTensor', 20000)
tests.cudaSpeedTest = speedTestFactory('torch.CudaTensor', 20000)


tests.floatPickSpeedTest = speedTestFactory('torch.FloatTensor', 20000, 2000)
tests.doublePickSpeedTest = speedTestFactory('torch.DoubleTensor', 20000, 2000)
tests.cudaPickSpeedTest = speedTestFactory('torch.CudaTensor', 20000, 2000)


tester:add(tests)
tester:run()
