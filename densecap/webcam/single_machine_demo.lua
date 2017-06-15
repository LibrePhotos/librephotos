require 'torch'
require 'cutorch'
require 'nn'
require 'cunn'
require 'cudnn'
cudnn.benchmark = true
require 'image'
require 'camera'
require 'qt'
require 'qttorch'
require 'qtwidget'

require 'densecap.DenseCapModel'
require 'densecap.modules.BoxIoU'

local utils = require 'densecap.utils'
local box_utils = require 'densecap.box_utils'
local vis_utils = require 'densecap.vis_utils'

local cmd = torch.CmdLine()
cmd:option('-checkpoint',
  'data/models/densecap/densecap-pretrained-vgg16.t7')
cmd:option('-display_image_height', 480)
cmd:option('-display_image_width', 640)
cmd:option('-model_image_size', 480)
cmd:option('-num_proposals', 50)
cmd:option('-boxes_to_show', 10)
cmd:option('-webcam_fps', 60)
cmd:option('-gpu', 0)
cmd:option('-timing', 0)
cmd:option('-detailed_timing', 0)
cmd:option('-text_size', 2)
cmd:option('-box_width', 2)
cmd:option('-rpn_nms_thresh', 0.7)
cmd:option('-final_nms_thresh', 0.3)
cmd:option('-use_cudnn', 1)


local function grab_frame(opt, cam)
  local timer = nil
  if opt.timing == 1 then
    cutorch.synchronize()
    timer = torch.Timer()
  end

  local img_orig = cam:forward()
  local img = image.scale(img_orig, opt.model_image_size)
  local img_caffe = img:index(1, torch.LongTensor{3, 2, 1}):mul(255)
  local vgg_mean = torch.Tensor{103.939, 116.779, 123.68}
  img_caffe:add(-1, vgg_mean:view(3, 1, 1):expandAs(img_caffe))
  local H, W = img_caffe:size(2), img_caffe:size(3)
  img_caffe = img_caffe:view(1, 3, H, W)

  if opt.timing == 1 then
    cutorch.synchronize()
    print('grab_frame took ', timer:time().real)
  end

  return img_orig, img_caffe
end


local function run_model(opt, info, model, img_caffe)
  local timer = nil
  if opt.timing == 1 then
    cutorch.synchronize()
    timer = torch.Timer()
  end

  local model_timer = nil
  if opt.timing == 1 then
    model_timer = torch.Timer()
    cutorch.synchronize()
    model.timing = opt.detailed_timing
  end
  local boxes_xcycwh, scores, captions = model:forward_test(img_caffe:cuda())
  if opt.timing == 1 then
    cutorch.synchronize()
    print(string.format('    model_forward took %f', model_timer:time().real))
    if opt.detailed_timing == 1 then
      for k, v in pairs(model.stats.times) do
        print(string.format('    %s took %f', k, v))
      end
    end
  end
  local num_boxes = math.min(boxes_xcycwh:size(1), opt.boxes_to_show)
  boxes_xcycwh = boxes_xcycwh[{{1, num_boxes}}]

  if opt.timing == 1 then
    cutorch.synchronize()
    print('run_model took ', timer:time().real)
  end

  return boxes_xcycwh:float(), captions
end


local function show_results(opt, img_orig, img_caffe, win, boxes_xcycwh, captions)
  local timer = nil
  if opt.timing == 1 then
    cutorch.synchronize()
    timer = torch.Timer()
  end

  local boxes_xywh = box_utils.xcycwh_to_xywh(boxes_xcycwh)
  local scale = img_orig:size(2) / img_caffe:size(3)
  boxes_xywh = box_utils.scale_boxes_xywh(boxes_xywh, scale)
  
  -- Draw boxes in the image
  local draw_options = {text_size=opt.text_size, box_width=opt.box_width}
  local img_disp = vis_utils.densecap_draw(img_orig, boxes_xywh, captions, draw_options)
  img_disp:clamp(0, 1)

  -- Show the image
  if not win then
    -- On the first call just use image.display
    win = image.display{image=img_disp, win=win}
  else
    -- Re-calling image.display for the same window invokes the garbage
    -- collector, which kills the framerate. Therefore we dip into qt
    -- and update it ourselves.
    win.image = img_disp
    local size = win.window.size:totable()
    local qtimg = qt.QImage.fromTensor(img_disp)
    win.painter:image(0, 0, size.width, size.height, qtimg)
  end

  if opt.timing == 1 then
    cutorch.synchronize()
    print('show_results took ', timer:time().real)
  end

  return win
end


local function temporal_smoothing(prev_boxes, prev_captions, cur_boxes, cur_captions)
  -- Reorder the current boxes to match the order of boxes from the
  -- previous frame; this prevents colors of stable detections from bouncing
  -- around too much.
  -- TODO: Do something fancier?

  local ious = nn.BoxIoU():float():forward{
                  prev_boxes:view(1, -1, 4),
                  cur_boxes:view(1, -1, 4)}[1]
  local num_cur = cur_boxes:size(1)
  local num_prev = prev_boxes:size(1)
  local idx = torch.LongTensor(num_cur)
  for i = 1, math.min(num_prev, num_cur) do
    local _, j = ious[i]:max(1)
    j = j[1]
    idx[i] = j
    ious[{{}, j}] = -1
  end
  if num_cur > num_prev then
    for i = num_prev + 1, num_cur do
      local _, j = ious:max(1):max(2)
      j = j[1]
      idx[i] = j
      ious[{{}, j}] = -1
    end
  end

  local new_boxes = cur_boxes:index(1, idx)
  local new_captions = {}
  for i = 1, num_cur do
    new_captions[i] = cur_captions[idx[i]]
  end

  return new_boxes, new_captions
end


local function main()
  local opt = cmd:parse(arg)
  local dtype, use_cudnn = utils.setup_gpus(opt.gpu, opt.use_cudnn)

  -- Load the checkpoint
  print('loading checkpoint from ' .. opt.checkpoint)
  local checkpoint = torch.load(opt.checkpoint)
  local model = checkpoint.model
  print('done loading checkpoint')

  -- Ship checkpoint to GPU and convert to cuDNN
  model:convert(dtype, use_cudnn)
  model:setTestArgs{
    rpn_nms_thresh = opt.rpn_nms_thresh,
    final_nms_thresh = opt.final_nms_thresh,
    num_proposals = opt.num_proposals,
  }
  model:evaluate()

  local win = nil
  local camera_opt = {
    fps=opt.webcam_fps,
    height=opt.display_image_height,
    width=opt.display_image_width,
  }
  local cam = image.Camera(camera_opt)

  -- Some variables for managing state
  local attached_handler = false
  local paused = false
  local prev_boxes, prev_captions = nil, nil

  local timer = torch.Timer()
  while true do
    if opt.timing == 1 then
      cutorch.synchronize()
      timer:reset()
    end

    if not paused then
      local img_orig, img_caffe = grab_frame(opt, cam)
      local boxes_xcycwh, captions = run_model(opt, info, model, img_caffe)

      if prev_boxes then
        boxes_xcycwh, captions = temporal_smoothing(prev_boxes, prev_captions,
                                                    boxes_xcycwh, captions)
      end
      win = show_results(opt, img_orig, img_caffe, win, boxes_xcycwh, captions)

      prev_boxes = boxes_xcycwh
      prev_captions = captions
    end

    if not attached_handler then
      attached_handler = true
      qt.connect(
        qt.QtLuaListener(win.window),
        'sigKeyPress(QString,QByteArray,QByteArray)',
        function(a, b, c)
          if b == 'Key_Space' then
            paused = not paused
          elseif b == 'Key_Left' then
            opt.boxes_to_show = math.max(1, opt.boxes_to_show - 1)
          elseif b == 'Key_Right' then
            opt.boxes_to_show = opt.boxes_to_show + 1
          end
        end)
    end

    qt.doevents()

    if opt.timing == 1 then
      cutorch.synchronize()
      local time = timer:time().real
      local fps = 1.0 / time
      local msg = 'Iteration took %.3f (%.2f FPS)'
      print(string.format(msg, time, fps))
      print ''
    end
  end
end

main()

