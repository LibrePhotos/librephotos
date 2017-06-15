require 'densecap.LocalizationLayer'

local tests = torch.TestSuite()
local tester = torch.Tester()


local function check_dims(t, dims)
  tester:asserteq(t:dim(), #dims)
  for i = 1, t:dim() do
    tester:assert(t:size(i) == dims[i])
  end
end


function simpleTest(dtype)
  return function()
    if dtype == 'torch.CudaTensor' then
      require 'cutorch'
      require 'cunn'
    end

    local C, X, Y = 128, 7, 7
    local opt = {
      input_dim=C,
      output_height=Y,
      output_width=X,
      field_centers={1, 1, 10, 10},
      mid_box_reg_weight=1.0,
      mid_objectness_weight=1.0,
    }
    if dtype == 'torch.FloatTensor' then
      opt.backend = 'nn'
    end

    local layer = nn.LocalizationLayer(opt):type(dtype)

    -- Make sure training-time forward pass works
    local B = 50
    local H, W = 1920, 1080
    local HH, WW = 192, 108
    local L, V = 10, 100
    local x = torch.randn(1, C, HH, WW):type(dtype)
    local gt_boxes = torch.randn(1, B, 4):add(1.0):mul(100):abs():type(dtype)
    local gt_labels =   torch.LongTensor(1, B, L):random(V):type(dtype)
    layer:setImageSize(H, W)
    layer:setGroundTruth(gt_boxes, gt_labels)
    local out = layer:forward(x)
    
    tester:assert(#out == 4)
    local roi_features = out[1]
    local roi_boxes = out[2]
    local gt_boxes_sample = out[3]
    local gt_labels_sample = out[4]
    local N = roi_features:size(1)
    local P = gt_boxes_sample:size(1)
    check_dims(roi_features, {N, C, Y, X})
    check_dims(roi_boxes, {N, 4})
    check_dims(gt_boxes_sample, {P, 4})
    check_dims(gt_labels_sample, {P, L})
    
    -- Make sure that training-time backward pass works
    local dout = torch.randn(#out)
    local dout = {
      torch.randn(#out[1]):type(dtype),
      torch.randn(#out[2]):type(dtype),
      torch.Tensor():type(dtype),
      torch.Tensor():type(dtype),
    }
    local dx = layer:backward(x, dout)
    check_dims(dx, {1, C, HH, WW})
    
    -- Make sure that test-time forward pass works
    layer:evaluate()
    layer:setImageSize(H, W)
    local out = layer:forward(x)
    local roi_features = out[1]
    local roi_boxes = out[2]
    local gt_boxes_sample = out[3]
    local gt_labels_sample = out[4]
    local N = roi_features:size(1)
    check_dims(roi_features, {N, C, Y, X})
    check_dims(roi_boxes, {N, 4})
    tester:assert(gt_boxes_sample:nElement() == 0)
    tester:assert(gt_labels_sample:nElement() == 0)
  end
end

tests.simpleTestCuda = simpleTest('torch.CudaTensor')
tests.simpleTestFloat = simpleTest('torch.FloatTensor')


tester:add(tests)
tester:run()
