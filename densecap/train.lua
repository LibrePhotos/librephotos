--[[
Main entry point for training a DenseCap model
]]--

-------------------------------------------------------------------------------
-- Includes
-------------------------------------------------------------------------------
require 'torch'
require 'nngraph'
require 'optim'
require 'image'
require 'lfs'
require 'nn'
local cjson = require 'cjson'

require 'densecap.DataLoader'
require 'densecap.DenseCapModel'
require 'densecap.optim_updates'
local utils = require 'densecap.utils'
local opts = require 'train_opts'
local models = require 'models'
local eval_utils = require 'eval.eval_utils'

-------------------------------------------------------------------------------
-- Initializations
-------------------------------------------------------------------------------
local opt = opts.parse(arg)
print(opt)
torch.setdefaulttensortype('torch.FloatTensor')
torch.manualSeed(opt.seed)
if opt.gpu >= 0 then
  -- cuda related includes and settings
  require 'cutorch'
  require 'cunn'
  require 'cudnn'
  cutorch.manualSeed(opt.seed)
  cutorch.setDevice(opt.gpu + 1) -- note +1 because lua is 1-indexed
end

-- initialize the data loader class
local loader = DataLoader(opt)
opt.seq_length = loader:getSeqLength()
opt.vocab_size = loader:getVocabSize()
opt.idx_to_token = loader.info.idx_to_token

-- initialize the DenseCap model object
local dtype = 'torch.CudaTensor'
local model = models.setup(opt):type(dtype)

-- get the parameters vector
local params, grad_params, cnn_params, cnn_grad_params = model:getParameters()
print('total number of parameters in net: ', grad_params:nElement())
print('total number of parameters in CNN: ', cnn_grad_params:nElement())

-------------------------------------------------------------------------------
-- Loss function
-------------------------------------------------------------------------------
local loss_history = {}
local all_losses = {}
local results_history = {}
local iter = 0
local function lossFun()
  grad_params:zero()
  if opt.finetune_cnn_after ~= -1 and iter >= opt.finetune_cnn_after then
    cnn_grad_params:zero() 
  end
  model:training()

  -- Fetch data using the loader
  local timer = torch.Timer()
  local info
  local data = {}
  data.image, data.gt_boxes, data.gt_labels, info, data.region_proposals = loader:getBatch()
  for k, v in pairs(data) do
    data[k] = v:type(dtype)
  end
  if opt.timing then cutorch.synchronize() end
  local getBatch_time = timer:time().real

  -- Run the model forward and backward
  model.timing = opt.timing
  model.cnn_backward = false
  if opt.finetune_cnn_after ~= -1 and iter > opt.finetune_cnn_after then
    model.finetune_cnn = true
  end
  model.dump_vars = false
  if opt.progress_dump_every > 0 and iter % opt.progress_dump_every == 0 then
    model.dump_vars = true
  end
  local losses, stats = model:forward_backward(data)

  -- Apply L2 regularization
  if opt.weight_decay > 0 then
    grad_params:add(opt.weight_decay, params)
    if cnn_grad_params then cnn_grad_params:add(opt.weight_decay, cnn_params) end
  end

  --+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  -- Visualization/Logging code
  --+++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++++
  if opt.losses_log_every > 0 and iter % opt.losses_log_every == 0 then
    local losses_copy = {}
    for k, v in pairs(losses) do losses_copy[k] = v end
    loss_history[iter] = losses_copy
  end

  return losses, stats
end

-------------------------------------------------------------------------------
-- Main loop
-------------------------------------------------------------------------------
local loss0
local optim_state = {}
local cnn_optim_state = {}
local best_val_score = -1
while true do  

  -- Compute loss and gradient
  local losses, stats = lossFun()

  -- Parameter update
  adam(params, grad_params, opt.learning_rate, opt.optim_beta1,
       opt.optim_beta2, opt.optim_epsilon, optim_state)

  -- Make a step on the CNN if finetuning
  if opt.finetune_cnn_after >= 0 and iter >= opt.finetune_cnn_after then
    adam(cnn_params, cnn_grad_params, opt.learning_rate,
         opt.optim_beta1, opt.optim_beta2, opt.optim_epsilon, cnn_optim_state)
  end

  -- print loss and timing/benchmarks
  print(string.format('iter %d: %s', iter, utils.build_loss_string(losses)))
  if opt.timing then print(utils.build_timing_string(stats.times)) end

  if ((opt.eval_first_iteration == 1 or iter > 0) and iter % opt.save_checkpoint_every == 0) or (iter+1 == opt.max_iters) then

    -- Set test-time options for the model
    model.nets.localization_layer:setTestArgs{
      nms_thresh=opt.test_rpn_nms_thresh,
      max_proposals=opt.test_num_proposals,
    }
    model.opt.final_nms_thresh = opt.test_final_nms_thresh

    -- Evaluate validation performance
    local eval_kwargs = {
      model=model,
      loader=loader,
      split='val',
      max_images=opt.val_images_use,
      dtype=dtype,
    }
    local results = eval_utils.eval_split(eval_kwargs)
    -- local results = eval_split(1, opt.val_images_use) -- 1 = validation
    results_history[iter] = results

    -- serialize a json file that has all info except the model
    local checkpoint = {}
    checkpoint.opt = opt
    checkpoint.iter = iter
    checkpoint.loss_history = loss_history
    checkpoint.results_history = results_history
    cjson.encode_number_precision(4) -- number of sig digits to use in encoding
    cjson.encode_sparse_array(true, 2, 10)
    local text = cjson.encode(checkpoint)
    local file = io.open(opt.checkpoint_path .. '.json', 'w')
    file:write(text)
    file:close()
    print('wrote ' .. opt.checkpoint_path .. '.json')

    -- Only save t7 checkpoint if there is an improvement in mAP
    if results.ap_results.map > best_val_score then
      best_val_score = results.ap_results.map
      checkpoint.model = model

      -- We want all checkpoints to be CPU compatible, so cast to float and
      -- get rid of cuDNN convolutions before saving
      model:clearState()
      model:float()
      if cudnn then
        cudnn.convert(model.net, nn)
        cudnn.convert(model.nets.localization_layer.nets.rpn, nn)
      end
      torch.save(opt.checkpoint_path, checkpoint)
      print('wrote ' .. opt.checkpoint_path)

      -- Now go back to CUDA and cuDNN
      model:cuda()
      if cudnn then
        cudnn.convert(model.net, cudnn)
        cudnn.convert(model.nets.localization_layer.nets.rpn, cudnn)
      end

      -- All of that nonsense causes the parameter vectors to be reallocated, so
      -- we need to reallocate the params and grad_params vectors.
      params, grad_params, cnn_params, cnn_grad_params = model:getParameters()
    end
  end
    
  -- stopping criterions
  iter = iter + 1
  -- Collect garbage every so often
  if iter % 33 == 0 then collectgarbage() end
  if loss0 == nil then loss0 = losses.total_loss end
  if losses.total_loss > loss0 * 100 then
    print('loss seems to be exploding, quitting.')
    break
  end
  if opt.max_iters > 0 and iter >= opt.max_iters then break end
end
