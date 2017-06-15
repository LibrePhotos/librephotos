local layer, parent = torch.class('nn.MakeAnchors', 'nn.Module')

--[[
A module that constructs anchor positions. Given k anchor boxes with different 
widths and heights, we want to slide those anchors across every position of the 
input feature map and output the coordinates of all these anchors.

Note that this module does not actually use the input (only its size) so its
backward pass always computes zero.

The constructor takes the following arguments:

- x0, y0: Numbers giving coordinates of receptive field centers for upper left
  corner of inputs.
- sx, sy: Numbers giving horizontal and vertical stride between receptive field
  centers.
- anchors: Tensor of shape (2, k) giving width and height for each of k anchor
  boxes.

Input:
N x C x H x W array of features

Output:
N x 4k x H x W array of anchor positions; if you reshape the output to
N x k x 4 x H x W then along the 3rd dim we have (xc, yc, w, h) giving the 
coordinates of the anchor box at that location.
--]]


function layer:__init(x0, y0, sx, sy, anchors)
  parent.__init(self)
  self.x0 = x0
  self.y0 = y0
  self.sx = sx
  self.sy = sy
  self.anchors = anchors:clone()
end


function layer:updateOutput(input)
  local N, H, W = input:size(1), input:size(3), input:size(4)
  local k = self.anchors:size(2)

  -- CudaTensor does not implement an in-place range method,
  -- so we have to use torch.range to allocate a new DoubleTensor
  -- then cast it to the right type.
  local x_centers = torch.range(0, W - 1):typeAs(input)
  x_centers:mul(self.sx):add(self.x0)
  local y_centers = torch.range(0, H - 1):typeAs(input)
  y_centers:mul(self.sy):add(self.y0)
  
  self.output:resize(N, 4 * k, H, W)
  local output_view = self.output:view(N, k, 4, H, W)

  -- Each of these is N x k x H x W
  local xc = output_view:select(3, 1)
  local yc = output_view:select(3, 2)
  local w = output_view:select(3, 3)
  local h = output_view:select(3, 4)

  xc:copy(x_centers:view(1, 1, 1, W):expand(N, k, H, W))
  yc:copy(y_centers:view(1, 1, H, 1):expand(N, k, H, W))
  w:copy(self.anchors[1]:view(1, k, 1, 1):expand(N, k, H, W))
  h:copy(self.anchors[2]:view(1, k, 1, 1):expand(N, k, H, W))

  return self.output
end


function layer:updateGradInput(input, gradOutput)
  self.gradInput:resizeAs(input):zero()
  return self.gradInput
end
