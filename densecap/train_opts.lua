local M = { }

function M.parse(arg)

  cmd = torch.CmdLine()
  cmd:text()
  cmd:text('Train a DenseCap model.')
  cmd:text()
  cmd:text('Options')

  -- Core ConvNet settings
  cmd:option('-backend', 'cudnn', 'nn|cudnn')
  

  -- Model settings
  cmd:option('-rpn_hidden_dim', 512,
    'Hidden size for the extra convolution in the RPN')
  cmd:option('-sampler_batch_size', 256,
    'Batch size to use in the box sampler')
  cmd:option('-rnn_size', 512,
    'Number of units to use at each layer of the RNN')
  cmd:option('-input_encoding_size', 512,
    'Dimension of the word vectors to use in the RNN')
  cmd:option('-sampler_high_thresh', 0.7,
    'Boxes with IoU greater than this with a GT box are considered positives')
  cmd:option('-sampler_low_thresh', 0.3,
    'Boxes with IoU less than this with all GT boxes are considered negatives')
  cmd:option('-train_remove_outbounds_boxes', 1,
    'Whether to ignore out-of-bounds boxes for sampling at training time')
  
  -- Loss function weights
  cmd:option('-mid_box_reg_weight', 0.05,
    'Weight for box regression in the RPN')
  cmd:option('-mid_objectness_weight', 0.1,
    'Weight for box classification in the RPN')
  cmd:option('-end_box_reg_weight', 0.1,
    'Weight for box regression in the recognition network')
  cmd:option('-end_objectness_weight', 0.1,
    'Weight for box classification in the recognition network')
  cmd:option('-captioning_weight',1.0, 'Weight for captioning loss')
  cmd:option('-weight_decay', 1e-6, 'L2 weight decay penalty strength')
  cmd:option('-box_reg_decay', 5e-5,
    'Strength of pull that boxes experience towards their anchor')

  -- Data input settings
  cmd:option('-data_h5', 'data/VG-regions.h5', 
    'HDF5 file containing the preprocessed dataset (from proprocess.py)')
  cmd:option('-data_json', 'data/VG-regions-dicts.json',
    'JSON file containing additional dataset info (from preprocess.py)')
  cmd:option('-proposal_regions_h5', '',
    'override RPN boxes with boxes from this h5 file (empty = don\'t override)')
  cmd:option('-debug_max_train_images', -1,
    'Use this many training images (for debugging); -1 to use all images')

  -- Optimization
  cmd:option('-learning_rate', 1e-5, 'learning rate to use')
  cmd:option('-optim_beta1', 0.9, 'beta1 for adam')
  cmd:option('-optim_beta2', 0.999, 'beta2 for adam')
  cmd:option('-optim_epsilon', 1e-8, 'epsilon for smoothing')
  cmd:option('-drop_prob', 0.5, 'Dropout strength throughout the model.')
  cmd:option('-max_iters', -1, 'Number of iterations to run; -1 to run forever')
  cmd:option('-checkpoint_start_from', '',
    'Load model from a checkpoint instead of random initialization.')
  cmd:option('-finetune_cnn_after', -1,
    'Start finetuning CNN after this many iterations (-1 = never finetune)')
  cmd:option('-val_images_use', 1000,
    'Number of validation images to use for evaluation; -1 to use all')

  -- Model checkpointing
  cmd:option('-save_checkpoint_every', 10000,
    'How often to save model checkpoints')
  cmd:option('-checkpoint_path', 'checkpoint.t7',
    'Name of the checkpoint file to use')

  -- Test-time model options (for evaluation)
  cmd:option('-test_rpn_nms_thresh', 0.7,
    'Test-time NMS threshold to use in the RPN')
  cmd:option('-test_final_nms_thresh', 0.3,
    'Test-time NMS threshold to use for final outputs')
  cmd:option('-test_num_proposals', 1000,
    'Number of region proposal to use at test-time')

  -- Visualization
  cmd:option('-progress_dump_every', 100,
    'Every how many iterations do we write a progress report to vis/out ?. 0 = disable.')
  cmd:option('-losses_log_every', 10,
    'How often do we save losses, for inclusion in the progress dump? (0 = disable)')

  -- Misc
  cmd:option('-id', '',
    'an id identifying this run/job; useful for cross-validation')
  cmd:option('-seed', 123, 'random number generator seed to use')
  cmd:option('-gpu', 0, 'which gpu to use. -1 = use CPU')
  cmd:option('-timing', false, 'whether to time parts of the net')
  cmd:option('-clip_final_boxes', 1,
             'Whether to clip final boxes to image boundar')
  cmd:option('-eval_first_iteration',0,
    'evaluate on first iteration? 1 = do, 0 = dont.')

  cmd:text()
  local opt = cmd:parse(arg or {})
  return opt
end

return M
