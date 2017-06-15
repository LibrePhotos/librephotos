local box_utils = {}


--[[
Apply non-maximum suppression to bounding boxes by greedily selecting
boxes based on their score, ignoring boxes that have high IoU with boxes
already selected.

Inputs:
- boxes: Tensor of shape (N, 5) giving box coordinates and scores
  in the format (x1, y1, x2, y2, score)
- overlap: A scalar giving maximum IoU allowed between boxes

Returns:
- pick: A LongTensor of shape (K,) giving the indices of the boxes
  selected after non-maximum suppression, in order of decreasing score.
  In other words, pick[i] = j means that boxes[j] is the ith highest
  scoring box after NMS.

This function was adapted from fmassa/object-detection.torch:
https://github.com/fmassa/object-detection.torch/blob/master/nms.lua
per their license, we need to include the following:

Copyright (c) 2015, Francisco Massa
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
--]]
function box_utils.nms_old(boxes, overlap, verbose)
  local pick = torch.LongTensor()

  if boxes:numel() == 0 then
    return pick
  end

  local x1 = boxes[{{},1}]
  local y1 = boxes[{{},2}]
  local x2 = boxes[{{},3}]
  local y2 = boxes[{{},4}]
  local s = boxes[{{},-1}]

  local buffer = x1:clone()

  local area = boxes.new():resizeAs(s):zero()
  area:add(x2, -1, x1):add(1.0)
  buffer:add(y2, -1, y1):add(1.0)
  area:cmul(buffer)

  -- Always sort on CPU since CudaTensor sorting only works
  -- for axes less than 2048
  local vals, I = s:float():sort(1)

  pick:resize(s:size()):zero()
  local counter = 1
  local xx1 = boxes.new():zero()
  local yy1 = boxes.new():zero()
  local xx2 = boxes.new():zero()
  local yy2 = boxes.new():zero()

  local w = boxes.new():zero()
  local h = boxes.new():zero()

  while I:numel() > 0 do
    local last = I:size(1)
    local i = I[last]
    pick[counter] = i
    counter = counter + 1
    if last == 1 then
      break
    end
    I = I[{{1,last-1}}]

    -- TODO: If we need to speed this up, benchmarking shows that this
    -- block takes the majority of the time. For CudaTensor, is reasonable
    -- to compute IoU between all pairs for 10k boxes; maybe we could do that
    -- to avoid this expensive indexing?
    xx1:index(x1,1,I)
    xx1:cmax(x1[i])
    yy1:index(y1,1,I)
    yy1:cmax(y1[i])
    xx2:index(x2,1,I)
    xx2:cmin(x2[i])
    yy2:index(y2,1,I)
    yy2:cmin(y2[i])
    
    w:resizeAs(xx2):zero()
    w:add(xx2, -1, xx1):add(1.0):cmax(0)
    h:resizeAs(yy2):zero()
    h:add(yy2, -1, yy1):add(1.0):cmax(0)
    
    local inter = w
    inter:cmul(h)

    local o = h
    xx1:index(area,1,I)
    torch.cdiv(o,inter,xx1+area[i]-inter)
    
    -- for CudaTensors, le returns a CudaTensor but we really want a ByteTensor
    -- for masked indexing so we need to explicitly cast it.
    I = I[o:le(overlap):byte()]
  end
  
  pick = pick[{{1,counter-1}}]
  return pick
end


--[[
Bounding box non-maximum supression. Compared to the above version, this is much
faster; we achieve speedup by only computing the top max_boxes boxes for IoU,
and also swapping the order of IoU computation and indexing. Rather than computing
IoU between the current box and the remaining boxes, we compute IoU between the
current box and *all* boxes. This results in strictly more floating point operations
than the version above, but index is *so slow* that this ends up being significantly
faster.

We have also replaced the call to index with a call to gather, but that doesn't seem
to matter too much. Another strategy we could try would be to compute only IoU for
the boxes we care about as above, but use gather rather than index to pick out the
relevant elements.

Inputs:
- boxes: Tensor of shape (N, 5) giving box coordinates and scores
  in the format (x1, y1, x2, y2, score)
- overlap: A scalar giving maximum IoU allowed between boxes
- max_boxes: Optional integer giving the maximum number of boxes to return.
- verbose: If true, print some timing information.

Returns:
- pick: A LongTensor of shape (K,) giving the indices of the boxes
  selected after non-maximum suppression, in order of decreasing score.
  In other words, pick[i] = j means that boxes[j] is the ith highest
  scoring box after NMS. If max_boxes was given then K <= max_boxes.
--]]
function box_utils.nms(boxes, overlap, max_boxes, verbose)
  local timer = torch.Timer()
  local pick = torch.LongTensor()

  local s
  if type(boxes) == 'table' then
    -- unpack list into boxes array and scores array
    s = boxes[2]
    boxes = boxes[1]
  else
    -- boxes is a tensor and last column are scores
    s = boxes[{{},-1}]
  end

  if boxes:numel() == 0 then
    return pick
  end
  local x1 = boxes[{{},1}]
  local y1 = boxes[{{},2}]
  local x2 = boxes[{{},3}]
  local y2 = boxes[{{},4}]

  local buffer = x1:clone()

  local area = boxes.new():resizeAs(s):zero()
  area:add(x2, -1, x1):add(1.0)
  buffer:add(y2, -1, y1):add(1.0)
  area:cmul(buffer)

  -- Always sort on CPU since CudaTensor sorting only works
  -- for axes less than 2048
  local vals, I = s:float():sort(1)

  pick:resize(s:size()):zero()
  local counter = 1
  local xx1 = boxes.new():zero()
  local yy1 = boxes.new():zero()
  local xx2 = boxes.new():zero()
  local yy2 = boxes.new():zero()

  local w = boxes.new():zero()
  local h = boxes.new():zero()
  local inter = boxes.new()
  local union = boxes.new()
  local iou = boxes.new()
  local mask = torch.ByteTensor()
  
  local iou_time = 0
  local index_time = 0
  
  while (max_boxes == nil or counter <= max_boxes) and I:numel() > 0 do
    local last = I:size(1)
    local i = I[last]
    pick[counter] = i
    counter = counter + 1
    if last == 1 then
      break
    end
    I = I[{{1,last-1}}]

    -- Compute IoU between current box and all boxes
    if verbose then
      cutorch.synchronize()
      timer:reset()
    end
    xx1:cmax(x1, x1[i])
    xx2:cmin(x2, x2[i])
    yy1:cmax(y1, y1[i])
    yy2:cmin(y2, y2[i])
    w:add(xx2, -1, xx1):add(1.0):cmax(0)
    h:add(yy2, -1, yy1):add(1.0):cmax(0)
    inter:cmul(w, h)
    union:add(area, area[i]):add(-1, inter)
    iou:cdiv(inter, union)
    if verbose then
      cutorch.synchronize()
      iou_time = iou_time + timer:time().real
    end
    
    if verbose then
      cutorch.synchronize()
      timer:reset()
    end

    -- Figure out which boxes have IoU below the threshold with the current box;
    -- since we only really need to know IoU between the current box and the
    -- boxes specified by I, pick those elements out.
    mask:resize(#I):gather(iou:le(overlap):byte(), 1, I)
    if verbose then
      cutorch.synchronize()
      index_time = index_time + timer:time().real
    end
    I = I[mask]
  end

  if verbose then
    print('iou time: ', iou_time)
    print('index time: ', index_time)
  end
  
  pick = pick[{{1,counter-1}}]
  return pick
end


--[[
Convert boxes from (xc, yc, w, h) format to (x1, y2, x2, y2) format.

Input:
- boxes: Tensor of shape (N, B, 4) or (N, 4) giving boxes
  in (xc, yc, w, h) format.

Returns:
- Tensor of shape (N, B, 4) or (N, 4) giving boxes in (x1, y2, x2, y2) format;
  output shape will match input shape.
--]]
function box_utils.xcycwh_to_x1y1x2y2(boxes)
  local minibatch = true
  if boxes:nDimension() == 2 then
    minibatch = false
    boxes = boxes:view(1, boxes:size(1), 4)
  end
  local ret = boxes.new(#boxes)
  
  local xc = boxes:select(3, 1)
  local yc = boxes:select(3, 2)
  local w  = boxes:select(3, 3)
  local h  = boxes:select(3, 4)
  
  local x0 = ret:select(3, 1)
  local x1 = ret:select(3, 3)
  local y0 = ret:select(3, 2)
  local y1 = ret:select(3, 4)
  
  x0:div(torch.add(w,-1), 2.0):mul(-1):add(xc)
  x1:div(torch.add(w,-1), 2.0):add(xc)
  y0:div(torch.add(h,-1), 2.0):mul(-1):add(yc)
  y1:div(torch.add(h,-1), 2.0):add(yc)
  
  if not minibatch then
    ret = ret:view(boxes:size(2), 4)
  end
  
  return ret
end

--[[
Convert boxes from (x, y, w, h) format to (x1, y2, x2, y2) format.

Input:
- boxes: Tensor of shape (N, B, 4) or (N, 4) giving boxes
  in (x, y, w, h) format.

Returns:
- Tensor of shape (N, B, 4) or (N, 4) giving boxes in (x1, y2, x2, y2) format;
  output shape will match input shape.
--]]
function box_utils.xywh_to_x1y1x2y2(boxes)
  local minibatch = true
  if boxes:nDimension() == 2 then
    minibatch = false
    boxes = boxes:view(1, boxes:size(1), 4)
  end
  local ret = boxes.new(#boxes)
  
  local x = boxes:select(3, 1)
  local y = boxes:select(3, 2)
  local w = boxes:select(3, 3)
  local h = boxes:select(3, 4)
  
  local x0 = ret:select(3, 1)
  local x1 = ret:select(3, 3)
  local y0 = ret:select(3, 2)
  local y1 = ret:select(3, 4)
  
  x0:copy(x)
  y0:copy(y)
  x1:copy(x):add(w):add(-1)
  y1:copy(y):add(h):add(-1)

  if not minibatch then
    ret = ret:view(boxes:size(2), 4)
  end
  
  return ret
end


--[[
Convert boxes from (x1, y1, x2, y2) format to (x, y, w, y) format.

Input:
- boxes: Tensor of shape (N, B, 4) or (N, 4) giving boxes in (x1, y1, x2, y2) format.

Returns:
- Tensor of same shape as input giving boxes in (x, y, w, h) format.
--]]
function box_utils.x1y1x2y2_to_xywh(boxes)
  local minibatch = true
  if boxes:dim() == 2 then
    minibatch = false
    boxes = boxes:view(1, boxes:size(1), 4)
  end
  local ret = boxes.new(#boxes)

  local x0 = boxes:select(3, 1)
  local y0 = boxes:select(3, 2)
  local x1 = boxes:select(3, 3)
  local y1 = boxes:select(3, 4)

  local x = ret:select(3, 1)
  local y = ret:select(3, 2)
  local w = ret:select(3, 3)
  local h = ret:select(3, 4)

  x:copy(x0)
  y:copy(y0)
  w:add(x1, -1, x0):add(1)
  h:add(y1, -1, y0):add(1)

  if not minibatch then
    ret = ret:view(boxes:size(2), 4)
  end

  return ret
end


function box_utils.x1y1x2y2_to_xcycwh(boxes)
  local minibatch = true
  if boxes:dim() == 2 then
    minibatch = false
    boxes = boxes:view(1, boxes:size(1), 4)
  end
  local boxes_out = boxes.new(#boxes)

  local x0 = boxes:select(3, 1)
  local x1 = boxes:select(3, 3)
  local y0 = boxes:select(3, 2)
  local y1 = boxes:select(3, 4)

  local xc = boxes_out:select(3, 1)
  local yc = boxes_out:select(3, 2)
  local w  = boxes_out:select(3, 3)
  local h  = boxes_out:select(3, 4)

  xc:add(x0, x1):div(2.0)
  yc:add(y0, y1):div(2.0)
  w:add(x1, -1, x0)
  h:add(y1, -1, y0)

  if not minibatch then
    boxes_out = boxes_out:view(boxes:size(2), 4)
  end

  return boxes_out
end

function box_utils.xywh_to_xcycwh(boxes)
  local minibatch = true
  if boxes:dim() == 2 then
    minibatch = false
    boxes = boxes:view(1, boxes:size(1), 4)
  end
  local boxes_out = boxes.new(#boxes)

  local x0 = boxes:select(3, 1)
  local y0 = boxes:select(3, 2)
  local w0 = boxes:select(3, 3)
  local h0 = boxes:select(3, 4)

  local xc = boxes_out:select(3, 1)
  local yc = boxes_out:select(3, 2)
  local w  = boxes_out:select(3, 3)
  local h  = boxes_out:select(3, 4)

  xc:copy(x0):add(torch.div(w0,2))
  yc:copy(y0):add(torch.div(h0,2))
  w:copy(w0)
  h:copy(h0)

  if not minibatch then
    boxes_out = boxes_out:view(boxes:size(2), 4)
  end
  return boxes_out
end

function box_utils.xcycwh_to_xywh(boxes)
  local boxes_x1y1x2y2 = box_utils.xcycwh_to_x1y1x2y2(boxes)
  local boxes_xywh = box_utils.x1y1x2y2_to_xywh(boxes_x1y1x2y2)
  return boxes_xywh
end


--[[
Rescale boxes to convert from one coordinate system to another.

Inputs:
- boxes: Tensor of shape (N, 4) giving coordinates of boxes in (x, y, w, h) format.
- frac: Fraction by which to scale the boxes. For example if boxes assume that the input
  image has size 800x600 but we want to use them at 400x300 scale, then frac should be 0.5.

Returns:
- boxes_scaled: Tensor of shape (N, 4) giving rescaled box coordinates in (x, y, w, h) format.
--]]
function box_utils.scale_boxes_xywh(boxes, frac)
 -- bb is given as Nx4 tensor of x,y,w,h
 -- e.g. original width was 800 but now is 512, then frac will be 800/512 = 1.56
 local boxes_scaled = boxes:clone()
 boxes_scaled[{{}, {1, 2}}]:add(-1) -- put to 0-based coord system
 boxes_scaled:mul(frac) -- Scale
 boxes_scaled[{{}, {1, 2}}]:add(1) -- put back to 1-based coord system
 return boxes_scaled
end


--[[
Clip bounding boxes to a specified region.

Inputs:
- boxes: Tensor containing boxes, of shape (N, 4) or (N, M, 4)
- bounds: Table containing the following keys specifying the bounds:
  - x_min, x_max: Minimum and maximum values for x (inclusive)
  - y_min, y_max: Minimum and maximum values for y (inclusive)
- format: The format of the boxes; either 'x1y1x2y2' or 'xcycwh'.

Outputs:
- boxes_clipped: Tensor giving coordinates of clipped boxes; has
  same shape and format as input.
- valid: 1D byte Tensor indicating which bounding boxes are valid,
  in sense of completely out of bounds of the image.
--]]
function box_utils.clip_boxes(boxes, bounds, format)
  local boxes_clipped
  if format == 'x1y1x2y2' then
    boxes_clipped = boxes:clone()
  elseif format == 'xcycwh' then
    boxes_clipped = box_utils.xcycwh_to_x1y1x2y2(boxes)
  elseif format == 'xywh' then
    boxes_clipped = box_utils.xywh_to_x1y1x2y2(boxes)
  else
    error(string.format('Unrecognized box format "%s"', format))
  end

  -- Either way, boxes_clipped is now in (x1, y1, x2, y2) format
  -- but we need to make sure it has two dimensions
  if boxes_clipped:dim() == 3 then
    boxes_clipped = boxes_clipped:view(-1, 4)
  end

  -- Now we can actually clip the boxes
  boxes_clipped[{{}, 1}]:clamp(bounds.x_min, bounds.x_max - 1)
  boxes_clipped[{{}, 2}]:clamp(bounds.y_min, bounds.y_max - 1)
  boxes_clipped[{{}, 3}]:clamp(bounds.x_min + 1, bounds.x_max)
  boxes_clipped[{{}, 4}]:clamp(bounds.y_min + 1, bounds.y_max)

  local validx = torch.gt(boxes_clipped[{{},3}], boxes_clipped[{{},1}]):byte()
  local validy = torch.gt(boxes_clipped[{{},4}], boxes_clipped[{{},2}]):byte()
  local valid = torch.gt(torch.cmul(validx, validy), 0) -- logical and operator

  -- Convert to the same format as the input
  if format == 'xcycwh' then
    boxes_clipped = box_utils.x1y1x2y2_to_xcycwh(boxes_clipped)
  elseif format == 'xywh' then
    boxes_clipped = box_utils.x1y1x2y2_to_xywh(boxes_clipped)
  end

  -- Conver to the same shape as the input
  return boxes_clipped:viewAs(boxes), valid
end


--[[
Inputs:
- boxes: N x 4 in xcycwh format
- gt_boxes: M x 4 in xcycwh format
--]]
function box_utils.eval_box_recall(boxes, gt_boxes, ns)
  local iou_threshs = {0.5, 0.7, 0.9}
  if ns == nil then
    ns = {100, 200, 300}
  end

  local stats = {}

  require 'densecap.modules.BoxIoU'
  local boxes_view = boxes:view(1, -1, 4)
  local gt_boxes_view = gt_boxes:view(1, -1, 4)
  local box_iou = nn.BoxIoU():type(boxes:type())
  local ious = box_iou:forward{boxes_view, gt_boxes_view}  -- N x M
  ious = ious[1]
  for i = 1, #iou_threshs do
    local thresh = iou_threshs[i]
    local mask = torch.gt(ious, thresh)
    local hit = torch.gt(torch.cumsum(mask, 1), 0)
    local recalls = torch.sum(hit, 2):double():view(-1)
    recalls:div(gt_boxes:size(1))

    for j = 1, #ns do
      local n = ns[j]
      local key = string.format('%.2f_recall_at_%d', thresh, n)
      if n <= recalls:size(1) then
        stats[key] = recalls[n]
      end
    end
  end

  return stats
end

-- compute pairwise NxN IOU matrix in Nx4 array of boxes in x1y1x2y2 format
function box_utils.iou_matrix(boxes)
  local n = boxes:size(1)
  local D = torch.zeros(n,n)
  for i=1,n do
    local bb = boxes[i]
    D[{i,i}] = 1.0
    for j=i+1,n do
      local bb2 = boxes[j]
      local bi = {math.max(bb[1],bb2[1]), math.max(bb[2],bb2[2]),
                  math.min(bb[3],bb2[3]), math.min(bb[4],bb2[4])}
      local iw = bi[3]-bi[1]+1
      local ih = bi[4]-bi[2]+1
      if iw>0 and ih>0 then
        -- compute overlap as area of intersection / area of union
        local ua = (bb[3]-bb[1]+1)*(bb[4]-bb[2]+1)+
                   (bb2[3]-bb2[1]+1)*(bb2[4]-bb2[2]+1)-iw*ih
        local ov = iw*ih/ua
        D[{i,j}] = ov
        D[{j,i}] = ov
      end
    end
  end
  return D
end

function box_utils.merge_boxes(boxes, thr)
  assert(thr > 0)

  -- merge boxes in the ground truth
  local ix = {} -- output table of indices
  local D = box_utils.iou_matrix(boxes) -- compute pairwise IOU

  while true do 
    local good = torch.ge(D, thr)
    local good_sum = torch.sum(good, 1):view(-1)
    local topnum, topix = torch.max(good_sum, 1) -- topix is LongTensor of size 1
    if topnum[1] == 0 then break end -- we're done in this case
        
    local mergeix = torch.nonzero(good[topix[1]]):view(-1) -- a LongTensor with the indices to merge

    -- absorb group
    table.insert(ix, mergeix)
    D:indexFill(1, mergeix, 0)
    D:indexFill(2, mergeix, 0)
  end

  return ix
end

return box_utils