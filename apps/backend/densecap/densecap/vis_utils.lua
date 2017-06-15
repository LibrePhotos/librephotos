require 'image'

local vis_utils = {}

-- Some nice colors for drawing colors
vis_utils.WAD_COLORS = {
  {173, 35,  25 }, -- Red
  {42,  75,  215}, -- Blue
  {87,  87,  87 }, -- Dark Gray
  {29,  105, 20 }, -- Green
  {129, 74,  25 }, -- Brown
  -- {160, 160, 160}, -- Light Gray
  {129, 197, 122}, -- Light green
  {157, 175, 255}, -- Light blue
  {41,  208, 208}, -- Cyan
  {255, 146, 51 }, -- Orange
  {255, 238, 51 }, -- Yellow
  {233, 222, 187}, -- Tan
  {255, 205, 243}, -- Pink
  {0,   0,   0  }, -- Black
}


local function clamp(x, low, high)
  if x < low then
    return low
  elseif x > high then
    return high
  else
    return x
  end
end


--[[
Inputs:
- img: 3 x H x W Tensor of pixel data
- boxes: N x 4 Tensor of box coordinates in (x, y, w, h) format
- captions: Array of N strings

Returns:
- img_disp: Copy of img with boxes and captions drawn in
--]]
function vis_utils.densecap_draw(img, boxes, captions, options)
  local img = img:clone()
  
  local H, W = img:size(2), img:size(3)
  local N = boxes:size(1)

  options = options or {}
  local text_size = options.text_size or 1
  local box_width = options.box_width or 2

  local text_img = img:clone():zero()

  for i = 1, N do
    local rgb = vis_utils.WAD_COLORS[i % #vis_utils.WAD_COLORS + 1]
    local rgb_255 = {255 * rgb[1], 255 * rgb[2], 255 * rgb[3]}
    vis_utils.draw_box(img, boxes[i], rgb, box_width)
    local text_opt = {
      inplace=true,
      size=text_size,
      color=rgb_255,
    }
    local x = boxes[{i, 1}] + box_width + 1
    local y = boxes[{i, 2}] + box_width + 1
    local ok, err = pcall(function()
      image.drawText(text_img, captions[i], x, y, text_opt)
    end)
    if not ok then
      print('drawText out of bounds: ', x, y, W, H)
    end
  end
  text_img:div(255)
  img[torch.ne(text_img, 0)] = 0
  img:add(text_img)

  return img
end


function vis_utils.draw_box(img, box, color, lw)
  lw = lw or 1
  local x, y, w, h = unpack(box:totable())
  local H, W = img:size(2), img:size(3)

  local top_x1 = clamp(x - lw, 1, W)
  local top_x2 = clamp(x + w + lw, 1, W)
  local top_y1 = clamp(y - lw, 1, H)
  local top_y2 = clamp(y + lw, 1, H)

  local bottom_y1 = clamp(y + h - lw, 1, H)
  local bottom_y2 = clamp(y + h + lw, 1, H)

  local left_x1 = clamp(x - lw, 1, W)
  local left_x2 = clamp(x + lw, 1, W)
  local left_y1 = clamp(y - lw, 1, H)
  local left_y2 = clamp(y + h + lw, 1, H)

  local right_x1 = clamp(x + w - lw, 1, W)
  local right_x2 = clamp(x + w + lw, 1, W)

  for c = 1, 3 do
    local cc = color[c] / 255
    img[{c, {top_y1, top_y2}, {top_x1, top_x2}}] = cc
    img[{c, {bottom_y1, bottom_y2}, {top_x1, top_x2}}] = cc
    img[{c, {left_y1, left_y2}, {left_x1, left_x2}}] = cc
    img[{c, {left_y1, left_y2}, {right_x1, right_x2}}] = cc 
  end
end


return vis_utils
