require 'torch'
require 'nn'

require 'stn'
require 'densecap.modules.BatchBilinearSamplerBHWD'
require 'densecap.modules.BoxToAffine'

local layer, parent = torch.class('nn.BilinearRoiPooling', 'nn.Module')

--[[
BilinearRoiPooling is a layer that uses bilinear sampling to pool featurs for a
region of interest (RoI) into a fixed size.

The constructor takes inputs height and width, both integers giving the size to
which RoI features should be pooled. For example if RoI feature maps are being
fed to VGG-16 fully connected layers, then we should have height = width = 7.

WARNING: The bounding box coordinates given in the forward pass should be in
the coordinate system of the input image used to compute the feature map, NOT
in the coordinate system of the feature map. To properly compute the forward
pass, the module needs to know the size of the input image; therefore the method
setImageSize(image_height, image_width) must be called before each forward pass.

Inputs:
- feats: Tensor of shape (C, H, W) giving a convolutional feature map.
- boxes: Tensor of shape (B, 4) giving bounding box coordinates in
         (xc, yc, w, h) format; the bounding box coordinates are in
         coordinate system of the original image, NOT the convolutional
         feature map.

Return:
- roi_features:
--]]

function layer:__init(height, width)
  parent.__init(self)
  self.height = height
  self.width = width
  
  -- box_branch is a net to convert box coordinates of shape (B, 4)
  -- to sampling grids of shape (B, height, width)
  local box_branch = nn.Sequential()

  -- box_to_affine converts boxes of shape (B, 4) to affine parameter
  -- matrices of shape (B, 2, 3); on each forward pass we need to call
  -- box_to_affine:setSize() to set the size of the input image.
  self.box_to_affine = nn.BoxToAffine()
  box_branch:add(self.box_to_affine)

  -- Grid generator converts matrices to sampling grids of shape
  -- (B, height, width, 2).
  box_branch:add(nn.AffineGridGeneratorBHWD(height, width))

  self.net = nn.Sequential()
  local parallel = nn.ParallelTable()
  parallel:add(nn.Transpose({1, 2}, {2, 3}))
  parallel:add(box_branch)
  self.net:add(parallel)  
  self.net:add(nn.BatchBilinearSamplerBHWD())
  self.net:add(nn.Transpose({3, 4}, {2, 3}))

  -- Set these by calling setImageSize
  self.image_height = nil
  self.image_width = nil
  self.called_forward = false
  self.called_backward = false
end


function layer:clearState()
  self.net:clearState()
end


function layer:setImageSize(image_height, image_width)
  self.image_height = image_height
  self.image_width = image_width
  self.called_forward = false
  self.called_backward = false
  return self
end


function layer:updateOutput(input)
  assert(self.image_height and self.image_width and not self.called_forward,
         'Must call setImageSize before each forward pass')
  self.box_to_affine:setSize(self.image_height, self.image_width)
  self.output = self.net:forward(input)
  self.called_forward = true
  return self.output
end


function layer:updateGradInput(input, gradOutput)
  assert(self.image_height and self.image_width and not self.called_backward,
         'Must call setImageSize before each forward / backward pass')
  self.gradInput = self.net:backward(input, gradOutput)

  self.called_backward = true
  self.image_height = nil
  self.image_width = nil

  return self.gradInput
end
