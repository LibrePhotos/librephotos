require 'torch'
require 'cutorch'

require 'ApplyBoxTransform'
local gradcheck = require 'gradcheck'


local tests = {}
local tester = torch.Tester()


local function simpleTestFactory(dtype)
  return function()
    local B = 2
    local boxes = torch.Tensor(B, 4)
    boxes[1] = torch.Tensor{10, 20, 30, 40}
    boxes[2] = torch.Tensor{-30, 50, 100, 200}
    boxes = boxes:type(dtype)

    local trans = torch.Tensor(B, 4)
    trans[1] = torch.Tensor{0.5, -0.2, 0, math.log(2)}
    trans[2] = torch.Tensor{0, -0.5, math.log(0.5), math.log(1.1)}
    trans = trans:type(dtype)

    local mod = nn.ApplyBoxTransform():type(dtype)    
    local out = mod:forward{boxes, trans}

    local expected_out = torch.Tensor(B, 4)
    expected_out[1] = torch.Tensor{25, 12, 30, 80}
    expected_out[2] = torch.Tensor{-30, -50, 50, 220}
    expected_out = expected_out:type(dtype)

    tester:assertTensorEq(out, expected_out, 1e-5)
  end
end

tests.floatSimpleTest = simpleTestFactory('torch.FloatTensor')
tests.doubleSimpleTest = simpleTestFactory('torch.DoubleTensor')
tests.cudaSimpleTest = simpleTestFactory('torch.CudaTensor')


function tests.gradCheckTest()
  local B = 10
  local boxes = torch.randn(B, 4)
  local trans = torch.randn(B, 4)
  local mod = nn.ApplyBoxTransform()
  local out = mod:forward{boxes, trans}
  local dout = torch.randn(#out)
  local dboxes, dtrans = unpack(mod:backward({boxes, trans}, dout))
  
  local function f_boxes(x)
    return nn.ApplyBoxTransform():forward{x, trans}
  end
  
  local function f_trans(x)
    return nn.ApplyBoxTransform():forward{boxes, x}
  end
  
  local dboxes_num = gradcheck.numeric_gradient(f_boxes, boxes, dout, 1e-8)
  local dtrans_num = gradcheck.numeric_gradient(f_trans, trans, dout)

  tester:assertle(gradcheck.relative_error(dtrans, dtrans_num), 1e-5)
  tester:assertle(gradcheck.relative_error(dboxes, dboxes_num), 1e-5)
end


tester:add(tests)
tester:run()
