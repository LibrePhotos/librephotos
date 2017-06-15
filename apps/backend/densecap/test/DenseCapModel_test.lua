require 'densecap.DenseCapModel'


local tests = torch.TestSuite()
local tester = torch.Tester()


local function simpleTest(dtype)
  return function()
    local backend = 'nn'
    
    if dtype == 'torch.CudaTensor' then
      require 'cutorch'
      require 'cunn'
      backend = 'cudnn'
    end
    local L, V = 10, 100
    local opt = {
      vocab_size=V,
      mid_box_reg_weight=0.1,
      mid_objectness_weight=0.1,
      end_box_reg_weight=1.0,
      end_objectness_weight=1.0,
      captioning_weight=1.0,
      idx_to_token = {},
      seq_length=L,
      rnn_encoding_size=64,
      backend=backend,
    }
    local model = nn.DenseCapModel(opt):type(dtype)

    local H, W, B = 480, 640, 45
    local img = torch.randn(1, 3, H, W):type(dtype)
    local gt_boxes = torch.randn(1, B, 4):add(1.0):mul(100):abs():type(dtype)
    local gt_labels = torch.LongTensor(1, B, L):random(V):type(dtype)

    local data = {
      image=img,
      gt_boxes=gt_boxes,
      gt_labels=gt_labels,
    }
    local losses = model:forward_backward(data)
    print(losses)
  end
end

tests.simpleTestFloat = simpleTest('torch.FloatTensor')
tests.simpleTestCuda = simpleTest('torch.CudaTensor')

tester:add(tests)
tester:run()

