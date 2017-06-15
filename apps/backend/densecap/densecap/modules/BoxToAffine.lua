local layer, parent = torch.class('nn.BoxToAffine', 'nn.Module')

--[[
Convert bounding box coordinates to affine parameter matrices that can be used
to generate sampling grids for bilinear interpolation.

Input: Tensor of shape (B, 4) giving bounding box coordinates in (xc, yc, w, h)
       format.

Output: Tensor of shape (B, 2, 3) giving affine parameter matrices for boxes.

If the input image has height H and width W, then for each box (xc, yc, w, h)
we want to generate the following 2 x 3 affine transform matrix:

 [   h             2 * yc - H - 1 ]
 [  ---      0     -------------- ]
 [   H                  H - 1     ]
 [                                ]
 [           w     2 * xc - W - 1 ]
 [   0      ---    -------------- ]
 [           W          W - 1     ]

This looks funny because the affine transform matrices are expected to work on
normalized coordinates in the range [-1, 1] x [1, 1] rather than image space
coordinates in the range [1, W] x [1, H]. The (1, 3) and (2, 3) elements of the
matrix give the center of the bounding box in the normalized coordinate system,
and the (1, 1) and (2, 2) elements of the matrix give the size of the box in
the normalized coordinate system.

The matrix defines a mapping from the (normalized) output coordinate system to
the (normalized) input coordinate system so (0, 0) maps to the box center and
(+/- 1, +/- 1) map to the four corners of the box. This transform is achieved
by multiplying the parameter matrix on the right by the column vector
(y, x, 1).

NOTE: In the Spatial Transformer Networks paper, the parameter matrix expects
to multiply the vector (x, y, 1) but in qassemoquab/stnbhwd the
AffineGridGenerator expects (y, x, 1). This inconsistency is tough to catch
from numeric unit tests alone, so there is an iTorch notebook with visual
sanity check tests to make sure that bounding boxes in image coordinates are
selecting the correct portions of the image.

Thanks to normalized coordinates, H and W can be the size of the input image
but the affine parameter matrix can be used to sample from convolutional layers.
This works because the coordinate system of the conv feature map is shifted and
scaled relative to the coordinate system of the input image, which implies that
the normalized coordinate systems for the image and feature map are the same.

NOTE: This module will frequently be used with different underlying image sizes
at each iteration; for this reason the setSize method should be called before
each call to forward.
--]]


function layer:__init()
  parent.__init(self)
  self.H = nil
  self.W = nil
end


function layer:setSize(H, W)
  self.H = H
  self.W = W
  return self
end


function layer:updateOutput(input)
  assert(input:dim() == 2, 'Expected 2D input')
  local B = input:size(1)
  assert(input:size(2) == 4, 'Expected input of shape B x 4')

  assert(self.H and self.W, 'Need to call setSize before calling forward')

  local xc = input[{{}, 1}]
  local yc = input[{{}, 2}]
  local w = input[{{}, 3}]
  local h = input[{{}, 4}]

  self.output:resize(B, 2, 3):zero()
  local th11 = self.output[{{}, 1, 1}]
  local th13 = self.output[{{}, 1, 3}]
  local th22 = self.output[{{}, 2, 2}]
  local th23 = self.output[{{}, 2, 3}]

  th23:mul(xc, 2):add(-1 - self.W):div(self.W - 1)
  th13:mul(yc, 2):add(-1 - self.H):div(self.H - 1)
  th22:div(w, self.W)
  th11:div(h, self.H)

  return self.output
end


function layer:updateGradInput(input, gradOutput)
  assert(input:dim() == 2, 'Expected 2D input')
  local B = input:size(1)
  assert(input:size(2) == 4, 'Expected input of shape B x 4')

  assert(gradOutput:dim() == 3, 'Expected 3D gradOutput')
  assert(gradOutput:size(1) == B)
  assert(gradOutput:size(2) == 2)
  assert(gradOutput:size(3) == 3)

  self.gradInput:resizeAs(input):zero()
  self.gradInput[{{}, 1}]:mul(gradOutput[{{}, 2, 3}], 2 / (self.W - 1))
  self.gradInput[{{}, 2}]:mul(gradOutput[{{}, 1, 3}], 2 / (self.H - 1))
  self.gradInput[{{}, 3}]:mul(gradOutput[{{}, 2, 2}], 1 / self.W)
  self.gradInput[{{}, 4}]:mul(gradOutput[{{}, 1, 1}], 1 / self.H)

  -- Set these to nil after backward pass so we remember to call setSize
  -- in the forward pass
  self.H = nil
  self.W = nil

  return self.gradInput
end
