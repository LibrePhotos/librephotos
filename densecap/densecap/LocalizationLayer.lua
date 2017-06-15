require 'torch'
require 'nn'

require 'densecap.modules.OurCrossEntropyCriterion'
require 'densecap.modules.BilinearRoiPooling'
require 'densecap.modules.ReshapeBoxFeatures'
require 'densecap.modules.ApplyBoxTransform'
require 'densecap.modules.InvertBoxTransform'
require 'densecap.modules.BoxSamplerHelper'
require 'densecap.modules.RegularizeLayer'
require 'densecap.modules.MakeAnchors'

-- local net_utils = require 'net_utils'
local box_utils = require 'densecap.box_utils'
local utils = require 'densecap.utils'


--[[
A LocalizationLayer wraps up all of the complexities of detection regions and
using a spatial transformer to attend to their features. Used on its own, it can
be used for learnable region proposals; it can also be plugged into larger modules
to do region proposal + classification (detection) or region proposal + captioning\
(dense captioning).


Input:
- cnn_features: 1 x C x H x W array of CNN features

Returns: List of:
- roi_features: (pos + neg) x D x HH x WW array of features for RoIs;
  roi_features[{{1, pos}}] gives the features for the positive RoIs
  and the rest are negatives.
- roi_boxes: (pos + neg) x 4 array of RoI box coordinates (xc, yc, w, h);
  roi_boxes[{{1, pos}}] gives the coordinates for the positive boxes
  and the rest are negatives.
- gt_boxes_sample: pos x 4 array of ground-truth region boxes corresponding to
  sampled positives. This will be an empty Tensor at test-time.
- gt_labels_sample: pos x L array of ground-truth labels corresponding to sampled
  positives. This will be an empty Tensor at test-time.

Before each forward pass, you need to call the setImageSize method to set the size
of the underlying image for that forward pass. During training, you also need to call
the setGroundTruth method to set the ground-truth boxes and sequnces:
- gt_boxes: 1 x B1 x 4 array of ground-truth region boxes
- gt_labels: 1 x B1 x L array of ground-truth labels for regions

After each forward pass, the instance variable stats will be populated with useful
information; in particular stats.losses has all the losses.

If you set the instance variable timing to true, then stats.times will contain
times for all forward and backward passes.
--]]

local layer, parent = torch.class('nn.LocalizationLayer', 'nn.Module')


-- Forward declaration; defined below
local build_rpn


function layer:__init(opt)
  parent.__init(self)

  opt = opt or {}
  opt.input_dim = utils.getopt(opt, 'input_dim')
  opt.output_height = utils.getopt(opt, 'output_height')
  opt.output_width = utils.getopt(opt, 'output_width')

  -- list x0, y0, sx, sy
  opt.field_centers = utils.getopt(opt, 'field_centers')

  opt.backend = utils.getopt(opt, 'backend', 'cudnn')
  opt.rpn_filter_size = utils.getopt(opt, 'rpn_filter_size', 3)
  opt.rpn_num_filters = utils.getopt(opt, 'rpn_num_filters', 256)
  opt.zero_box_conv = utils.getopt(opt, 'zero_box_conv', true)
  opt.std = utils.getopt(opt, 'std', 0.01)
  opt.anchor_scale = utils.getopt(opt, 'anchor_scale', 1.0)

  opt.sampler_batch_size = utils.getopt(opt, 'sampler_batch_size', 256)
  opt.sampler_high_thresh = utils.getopt(opt, 'sampler_high_thresh', 0.7)
  opt.sampler_low_thresh = utils.getopt(opt, 'sampler_low_thresh', 0.5)
  opt.train_remove_outbounds_boxes = utils.getopt(opt, 'train_remove_outbounds_boxes', 1)

  utils.ensureopt(opt, 'mid_box_reg_weight')
  utils.ensureopt(opt, 'mid_objectness_weight')
  
  opt.box_reg_decay = utils.getopt(opt, 'box_reg_decay', 0)
  self.opt = opt

  self.losses = {}

  self.nets = {}

  -- Computes region proposals from conv features
  self.nets.rpn = build_rpn(opt)

  -- Performs positive / negative sampling of region proposals
  self.nets.box_sampler_helper = nn.BoxSamplerHelper{
                                    batch_size=opt.sampler_batch_size,
                                    low_thresh=opt.sampler_low_thresh,
                                    high_thresh=opt.sampler_high_thresh,
                                 }

  -- Interpolates conv features for each RoI
  self.nets.roi_pooling = nn.BilinearRoiPooling(opt.output_height, opt.output_width)

  -- Used to compute box regression targets from GT boxes
  self.nets.invert_box_transform = nn.InvertBoxTransform()

  -- Construct criterions
  self.nets.obj_crit_pos = nn.OurCrossEntropyCriterion() -- for objectness
  self.nets.obj_crit_neg = nn.OurCrossEntropyCriterion() -- for objectness
  self.nets.box_reg_crit = nn.SmoothL1Criterion() -- for RPN box regression

  -- Intermediates computed during forward pass

  -- Output of RPN
  self.rpn_out = nil
  self.rpn_boxes = nil
  self.rpn_anchors = nil
  self.rpn_trans = nil
  self.rpn_scores = nil

  -- Outputs of sampler
  self.pos_data = nil
  self.pos_boxes = nil
  self.pos_anchors = nil
  self.pos_trans = nil
  self.pos_target_data = nil
  self.pos_target_boxes = nil
  self.pos_target_labels = nil
  self.neg_data = nil
  self.neg_scores = nil
  self.roi_boxes = torch.Tensor()

  -- Used as targets for pos / neg objectness crits
  self.pos_labels = torch.Tensor()
  self.neg_labels = torch.Tensor()

  -- Used as targets for bounding box regression
  self.pos_trans_targets = torch.Tensor()

  -- Used to track image size; must call setImageSize before each forward pass
  self.image_width = nil
  self.image_height = nil
  self._called_forward_size = false
  self._called_backward_size = false

  -- Other instance variables
  self.timer = torch.Timer()
  self.timing = false     -- Set to true to enable timing
  self.dump_vars = false  -- Set to true to dump vars
  self:reset_stats()
  
  self:setTestArgs()
  self:training()
end

function layer:parameters()
  -- The only part of the DetectionModule that has parameters is the RPN,
  -- so just forward the call
  return self.nets.rpn:parameters()
end


-- This needs to be called before each forward pass
function layer:setImageSize(image_height, image_width)
  self.image_height = image_height
  self.image_width = image_width
  self._called_forward_size = false
  self._called_backward_size = false
end

--[[
This needs to be called before every training-time forward pass.

Inputs:
- gt_boxes: 1 x B1 x 4 array of ground-truth region boxes
- gt_labels: 1 x B1 x L array of ground-truth labels for regions
--]]
function layer:setGroundTruth(gt_boxes, gt_labels)
  self.gt_boxes = gt_boxes
  self.gt_labels = gt_labels
  self._called_forward_gt = false
  self._called_backward_gt = false
end


function layer:reset_stats()
  self.stats = {}
  self.stats.losses = {}
  self.stats.times = {}
  self.stats.vars = {}
end


function layer:clearState()
  self.timer = nil
  self.rpn_out = nil
  self.rpn_boxes = nil
  self.rpn_anchors = nil
  self.rpn_trans = nil
  self.rpn_scores = nil
  self.pos_data = nil
  self.pos_boxes = nil
  self.pos_anchors = nil
  self.pos_trans = nil
  self.pos_target_data = nil
  self.pos_target_boxes = nil
  self.pos_target_labels = nil
  self.neg_data = nil
  self.neg_scores = nil
  self.roi_boxes:set()
  self.nets.rpn:clearState()
  self.nets.roi_pooling:clearState()
end


function layer:timeit(name, f)
  self.timer = self.timer or torch.Timer()
  if self.timing then
    cutorch.synchronize()
    self.timer:reset()
    f()
    cutorch.synchronize()
    self.stats.times[name] = self.timer:time().real
  else
    f()
  end
end


function layer:setTestArgs(args)
  args = args or {}
  self.test_clip_boxes = utils.getopt(args, 'clip_boxes', true)
  self.test_nms_thresh = utils.getopt(args, 'nms_thresh', 0.7)
  self.test_max_proposals = utils.getopt(args, 'max_proposals', 300)
end


function layer:updateOutput(input)
  if self.train then
    return self:_forward_train(input)
  else
    return self:_forward_test(input)
  end
end


function layer:_forward_test(input)
  local cnn_features = input
  local arg = {
    clip_boxes = self.test_clip_boxes,
    nms_thresh = self.test_nms_thresh,
    max_proposals = self.test_max_proposals
  }

  -- Make sure that setImageSize has been called
  assert(self.image_height and self.image_width and not self._called_forward_size,
         'Must call setImageSize before each forward pass')
  self._called_forward_size = true

  local rpn_out
  self:timeit('rpn:forward_test', function()
    rpn_out = self.nets.rpn:forward(cnn_features)
  end)
  local rpn_boxes, rpn_anchors = rpn_out[1], rpn_out[2]
  local rpn_trans, rpn_scores = rpn_out[3], rpn_out[4]
  local num_boxes = rpn_boxes:size(2)

  -- Maybe clip boxes to image boundary
  local valid
  if arg.clip_boxes then
    local bounds = {
      x_min=1, y_min=1,
      x_max=self.image_width,
      y_max=self.image_height
    }
    rpn_boxes, valid = box_utils.clip_boxes(rpn_boxes, bounds, 'xcycwh')

    --print(string.format('%d/%d boxes are predicted valid',
    --      torch.sum(valid), valid:nElement()))

    -- Clamp parallel arrays only to valid boxes (not oob of the image)
    local function clamp_data(data)
      -- data should be 1 x kHW x D
      -- valid is byte of shape kHW
      assert(data:size(1) == 1, 'must have 1 image per batch')
      assert(data:dim() == 3)
      local mask = valid:view(1, -1, 1):expandAs(data)
      return data[mask]:view(1, -1, data:size(3))
    end
    rpn_boxes = clamp_data(rpn_boxes)
    rpn_anchors = clamp_data(rpn_anchors)
    rpn_trans = clamp_data(rpn_trans)
    rpn_scores = clamp_data(rpn_scores)

    num_boxes = rpn_boxes:size(2)
  end
  
  -- Convert rpn boxes from (xc, yc, w, h) format to (x1, y1, x2, y2)
  local rpn_boxes_x1y1x2y2 = box_utils.xcycwh_to_x1y1x2y2(rpn_boxes)

  -- Convert objectness positive / negative scores to probabilities
  local rpn_scores_exp = torch.exp(rpn_scores)
  local pos_exp = rpn_scores_exp[{1, {}, 1}]
  local neg_exp = rpn_scores_exp[{1, {}, 2}]
  local scores = (pos_exp + neg_exp):pow(-1):cmul(pos_exp)
  
  local verbose = false
  if verbose then
    print('in LocalizationLayer forward_test')
    print(string.format('Before NMS there are %d boxes', num_boxes))
    print(string.format('Using NMS threshold %f', arg.nms_thresh))
  end

  -- Run NMS and sort by objectness score
  local boxes_scores = scores.new(num_boxes, 5)
  boxes_scores[{{}, {1, 4}}] = rpn_boxes_x1y1x2y2
  boxes_scores[{{}, 5}] = scores
  local idx
  self:timeit('nms', function()
    if arg.max_proposals == -1 then
      idx = box_utils.nms(boxes_scores, arg.nms_thresh)
    else
       idx = box_utils.nms(boxes_scores, arg.nms_thresh, arg.max_proposals)
    end
  end)

  -- Use NMS indices to pull out corresponding data from RPN
  -- All these are being converted from (1, B2, D) to (B3, D)
  -- where B2 are the number of boxes after boundary clipping and B3
  -- is the number of boxes after NMS
  local rpn_boxes_nms = rpn_boxes:index(2, idx)[1]
  local rpn_anchors_nms = rpn_anchors:index(2, idx)[1]
  local rpn_trans_nms = rpn_trans:index(2, idx)[1]
  local rpn_scores_nms = rpn_scores:index(2, idx)[1]
  local scores_nms = scores:index(1, idx)

  if verbose then
    print(string.format('After NMS there are %d boxes', rpn_boxes_nms:size(1)))
  end

  -- Use roi pooling to get features for boxes
  local roi_features
  self:timeit('roi_pooling:forward_test', function()
    self.nets.roi_pooling:setImageSize(self.image_height, self.image_width)
    roi_features = self.nets.roi_pooling:forward{cnn_features[1], rpn_boxes_nms}
  end)
  
  if self.dump_vars then
    local vars = self.stats.vars or {}
    vars.test_rpn_boxes_nms = rpn_boxes_nms
    vars.test_rpn_anchors_nms = rpn_anchors_nms
    vars.test_rpn_scores_nms = scores:index(1, idx)
    self.stats.vars = vars
  end
  
  local empty = roi_features.new()
  self.output = {roi_features, rpn_boxes_nms, empty, empty}
  return self.output
  -- return roi_features, rpn_boxes_nms, scores_nms
end


--[[
Input: List of:
- cnn_features: N x C x H x W array of CNN features
- gt_boxes: N x B1 x 4 array of ground-truth region boxes
- gt_labels: N x B1 x L array of ground-truth labels for regions

Returns: List of:
- roi_features: B2 x D x HH x WW array of features for RoIs sampled as positives
- roi_boxes: B2 x 4 array of boxes for sampled RoIs (xc, yc, w, h)
- gt_boxes_sample: B2 x 4 array of ground-truth region boxes corresponding to
  sampled positives.
- gt_labels_sample: B2 x L array of ground-truth labels corresponding to sampled
  positives.

Running the forward pass also updates the instance variable losses, which is a
table mapping names of losses to their values.
--]]
function layer:_forward_train(input)
  local cnn_features = input
  assert(self.gt_boxes and self.gt_labels and not self._called_forward_gt,
         'Must call setGroundTruth before training-time forward pass')
  local gt_boxes, gt_labels = self.gt_boxes, self.gt_labels
  self._called_forward_gt = true

  -- Make sure that setImageSize has been called
  assert(self.image_height and self.image_width and not self._called_forward_size,
         'Must call setImageSize before each forward pass')
  self._called_forward_size = true

  local N = cnn_features:size(1)
  assert(N == 1, 'Only minibatches with N = 1 are supported')
  local B1 = gt_boxes:size(2)
  assert(gt_boxes:dim() == 3 and gt_boxes:size(1) == N and gt_boxes:size(3) == 4,
         'gt_boxes must have shape (N, B1, 4)')
  assert(gt_labels:dim() == 3 and gt_labels:size(1) == N and gt_labels:size(2) == B1,
         'gt_labels must have shape (N, B1, L)')

  self:reset_stats()

  -- Run the RPN forward
  self:timeit('rpn:forward', function()
    self.rpn_out = self.nets.rpn:forward(cnn_features)
    self.rpn_boxes = self.rpn_out[1]
    self.rpn_anchors = self.rpn_out[2]
    self.rpn_trans = self.rpn_out[3]
    self.rpn_scores = self.rpn_out[4]
  end)

  if self.opt.train_remove_outbounds_boxes == 1 then
    local image_height, image_width = nil, nil
    local bounds = {
      x_min=1, y_min=1,
      x_max=self.image_width, 
      y_max=self.image_height
    }
    self.nets.box_sampler_helper:setBounds(bounds)
  end

  -- Run the sampler forward
  self:timeit('sampler:forward', function()
    local sampler_out = self.nets.box_sampler_helper:forward{
                          self.rpn_out, {gt_boxes, gt_labels}}
   
    -- Unpack pos data
    self.pos_data, self.pos_target_data, self.neg_data = unpack(sampler_out)
    self.pos_boxes, self.pos_anchors = self.pos_data[1], self.pos_data[2]
    self.pos_trans, self.pos_scores = self.pos_data[3], self.pos_data[4]
    
    -- Unpack target data
    self.pos_target_boxes, self.pos_target_labels = unpack(self.pos_target_data)
    
    -- Unpack neg data (only scores matter)
    self.neg_boxes = self.neg_data[1]
    self.neg_scores = self.neg_data[4]
  end)
  local num_pos, num_neg = self.pos_boxes:size(1), self.neg_scores:size(1)
  
  -- Concatentate pos_boxes and neg_boxes into roi_boxes
  self.roi_boxes:resize(num_pos + num_neg, 4)
  self.roi_boxes[{{1, num_pos}}]:copy(self.pos_boxes)
  self.roi_boxes[{{num_pos + 1, num_pos + num_neg}}]:copy(self.neg_boxes)

  -- Run the RoI pooling forward for positive boxes
  self:timeit('roi_pooling:forward', function()
    self.nets.roi_pooling:setImageSize(self.image_height, self.image_width)
    self.roi_features = self.nets.roi_pooling:forward{cnn_features[1], self.roi_boxes}
  end)

  -- Compute objectness loss
  self:timeit('objectness_loss:forward', function()
    if self.pos_scores:type() ~= 'torch.CudaTensor' then
       -- ClassNLLCriterion expects LongTensor labels for CPU score types,
       -- but CudaTensor labels for GPU score types. self.pos_labels and
       -- self.neg_labels will be casted by any call to self:type(), so
       -- we need to cast them back to LongTensor for CPU tensor types.
       self.pos_labels = self.pos_labels:long()
       self.neg_labels = self.neg_labels:long()
    end
    self.pos_labels:resize(num_pos):fill(1)
    self.neg_labels:resize(num_neg):fill(2)
    local obj_loss_pos = self.nets.obj_crit_pos:forward(self.pos_scores, self.pos_labels)
    local obj_loss_neg = self.nets.obj_crit_neg:forward(self.neg_scores, self.neg_labels)
    local obj_weight = self.opt.mid_objectness_weight
    self.stats.losses.obj_loss_pos = obj_weight * obj_loss_pos
    self.stats.losses.obj_loss_neg = obj_weight * obj_loss_neg
  end)
      
  -- Compute targets for RPN bounding box regression
  self:timeit('invert_box_transform:forward', function()
    self.pos_trans_targets = self.nets.invert_box_transform:forward{
                                self.pos_anchors, self.pos_target_boxes}
  end)

  -- DIRTY DIRTY HACK: To prevent the loss from blowing up, replace boxes
  -- with huge pos_trans_targets with ground-truth
  local max_trans = torch.abs(self.pos_trans_targets):max(2)
  local max_trans_mask = torch.gt(max_trans, 10):expandAs(self.pos_trans_targets)
  local mask_sum = max_trans_mask:sum() / 4
  if mask_sum > 0 then
    local msg = 'WARNING: Masking out %d boxes in LocalizationLayer'
    print(string.format(msg, mask_sum))
    self.pos_trans[max_trans_mask] = 0
    self.pos_trans_targets[max_trans_mask] = 0
  end

  -- Compute RPN box regression loss
  self:timeit('box_reg_loss:forward', function()
    local crit = self.nets.box_reg_crit
    local weight = self.opt.mid_box_reg_weight
    local loss = weight * crit:forward(self.pos_trans, self.pos_trans_targets)
    self.stats.losses.box_reg_loss = loss
  end)
  
  -- Fish out the box regression loss
  local reg_mods = self.nets.rpn:findModules('nn.RegularizeLayer')
  assert(#reg_mods == 1)
  self.stats.losses.box_decay_loss = reg_mods[1].loss
  
  -- Compute total loss
  local total_loss = 0
  for k, v in pairs(self.stats.losses) do
   total_loss = total_loss + v
  end
  self.stats.losses.total_loss = total_loss

  if self.dump_vars then
    local vars = self.stats.vars or {}
    vars.pred_scores = self.rpn_scores[1]
    vars.pred_boxes = self.rpn_boxes[1]
    vars.pred_anchors = self.rpn_anchors[1]
    vars.aligned_pos_boxes = self.pos_boxes
    vars.aligned_pos_scores = self.pos_scores
    vars.aligned_target_boxes = self.pos_target_boxes
    vars.sampled_neg_boxes = self.neg_boxes
    vars.sampled_neg_scores = self.neg_scores
    self.stats.vars = vars
  end

  self.output = {self.roi_features, self.roi_boxes, self.pos_target_boxes, self.pos_target_labels}
  return self.output
end


function layer:updateGradInput(input, gradOutput)
  assert(self.train, 'can only call updateGradInput in training mode')
  assert(self.gt_boxes and self.gt_labels and not self._called_backward_gt,
         'Must call setGroundTruth before each forward pass')
  self._called_backward_gt = true
  
  assert(self.image_height and self.image_width and not self._called_backward_size,
         'Must call setImageSize before each forward pass')
  self._called_backward_size = true

  local cnn_features = input
  local gt_boxes = self.gt_boxes
  local gt_labels = self.gt_labels
  local grad_roi_features = gradOutput[1]
  local grad_roi_boxes = gradOutput[2]:clone()
  
  local num_pos, num_neg = self.pos_boxes:size(1), self.neg_scores:size(1)
  local grad_pos_boxes = grad_roi_boxes[{{1, num_pos}}]
  local grad_neg_boxes = grad_roi_boxes[{{num_pos + 1, num_pos + num_neg}}]
  
  local grad_cnn_features = self.gradInput
  grad_cnn_features:resizeAs(cnn_features):zero()

  -- Backprop RPN box regression loss
  local grad_pos_trans
  self:timeit('box_reg_loss:backward', function()
    local crit = self.nets.box_reg_crit
    local weight = self.opt.mid_box_reg_weight
    grad_pos_trans = crit:backward(self.pos_trans, self.pos_trans_targets)
    -- Note that this is a little weird - it modifies a modules gradInput
    -- in-place, which could cause trouble if this gradient is reused.
    grad_pos_trans:mul(weight)
  end)

  -- Backprop objectness loss
  local grad_pos_scores, grad_neg_scores
  self:timeit('objectness_loss:backward', function()
    grad_pos_scores = self.nets.obj_crit_pos:backward(self.pos_scores, self.pos_labels)
    --print('backward: ', self.neg_labels:nElement(), self.neg_labels:sum(), self.neg_scores:sum())
    grad_neg_scores = self.nets.obj_crit_neg:backward(self.neg_scores, self.neg_labels)
    -- Same problem as above - modifying gradients in-place may be dangerous
    grad_pos_scores:mul(self.opt.mid_objectness_weight)
    grad_neg_scores:mul(self.opt.mid_objectness_weight)
  end)
  
  -- Backprop RoI pooling
  --local grad_cnn_features
  self:timeit('roi_pooling:backward', function()
    local din = self.nets.roi_pooling:backward(
                    {cnn_features[1], self.roi_boxes},
                    grad_roi_features)
    grad_roi_boxes:add(din[2])
    grad_cnn_features:add(din[1]:viewAs(cnn_features))
  end)

  -- Backprop sampler
  local grad_rpn_out
  self:timeit('sampler:backward', function()
    local grad_pos_data, grad_neg_data = {}, {}
    grad_pos_data[1] = grad_pos_boxes
    grad_pos_data[3] = grad_pos_trans
    grad_pos_data[4] = grad_pos_scores
    grad_neg_data[1] = grad_neg_boxes
    grad_neg_data[4] = grad_neg_scores
    grad_rpn_out = self.nets.box_sampler_helper:backward(
                              {self.rpn_out, {gt_boxes, gt_labels}},
                              {grad_pos_data, grad_neg_data})
  end)
  
  -- Backprop RPN
  self:timeit('rpn:backward', function()
    local din = self.nets.rpn:backward(cnn_features, grad_rpn_out)
    grad_cnn_features:add(din)
  end)
  
  return self.gradInput
end


-- RPN returns {boxes, anchors, transforms, scores}
function build_rpn(opt)
  -- Set up anchor sizes
  local anchors = opt.anchors
  if not anchors then
    anchors = torch.Tensor({
                {45, 90}, {90, 45}, {64, 64},
                {90, 180}, {180, 90}, {128, 128},
                {181, 362}, {362, 181}, {256, 256},
                {362, 724}, {724, 362}, {512, 512},
              }):t():clone()
    anchors:mul(opt.anchor_scale)
  end
  local num_anchors = anchors:size(2)
  
  local rpn = nn.Sequential()

  -- Add an extra conv layer and a ReLU
  local pad = math.floor(opt.rpn_filter_size / 2)
  local conv_layer = nn.SpatialConvolution(
                        opt.input_dim,
                        opt.rpn_num_filters,
                        opt.rpn_filter_size,
                        opt.rpn_filter_size,
                        1, 1, pad, pad)
  conv_layer.weight:normal(0, opt.std)
  conv_layer.bias:zero()
  rpn:add(conv_layer)
  rpn:add(nn.ReLU(true))

  -- Branch to produce box coordinates for each anchor
  -- This branch will return {boxes, {anchors, transforms}}
  local box_branch = nn.Sequential()
  local box_conv_layer = nn.SpatialConvolution(
                            opt.rpn_num_filters,
                            4 * num_anchors,
                            1, 1, 1, 1, 0, 0)
  if opt.zero_box_conv then
    box_conv_layer.weight:zero()
  else
    box_conv_layer.weight:normal(0, opt.std)
  end
  box_conv_layer.bias:zero()
  box_branch:add(box_conv_layer)
  box_branch:add(nn.RegularizeLayer(opt.box_reg_decay))
  local x0, y0, sx, sy = unpack(opt.field_centers)
  local seq = nn.Sequential()
  seq:add(nn.MakeAnchors(x0, y0, sx, sy, anchors))
  seq:add(nn.ReshapeBoxFeatures(num_anchors))
  local cat1 = nn.ConcatTable()
  cat1:add(seq)
  cat1:add(nn.ReshapeBoxFeatures(num_anchors))
  box_branch:add(cat1)
  local cat2 = nn.ConcatTable()
  cat2:add(nn.ApplyBoxTransform())
  cat2:add(nn.Identity())
  box_branch:add(cat2)

  -- Branch to produce box / not box scores for each anchor
  local rpn_branch = nn.Sequential()
  local rpn_conv_layer = nn.SpatialConvolution(
                            opt.rpn_num_filters, 2 * num_anchors,
                            1, 1, 1, 1, 0, 0)
  rpn_conv_layer.weight:normal(0, opt.std)
  rpn_conv_layer.bias:zero()
  rpn_branch:add(rpn_conv_layer)
  rpn_branch:add(nn.ReshapeBoxFeatures(num_anchors))

  -- Concat and flatten the branches
  local concat = nn.ConcatTable()
  concat:add(box_branch)
  concat:add(rpn_branch)
  
  rpn:add(concat)
  rpn:add(nn.FlattenTable())
  
  if opt.backend == 'cudnn' then
    require 'cudnn'
    cudnn.convert(rpn, cudnn)
  end

  return rpn
end

