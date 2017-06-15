require 'loadcaffe'


local net_utils = {}


function net_utils.load_cnn(name, backend, path_offset)
  local model_dir, proto_file, model_file = nil, nil, nil
  if name == 'vgg-16' then
    model_dir = 'data/models/vgg-16'
    proto_file = 'VGG_ILSVRC_16_layers_deploy.prototxt'
    model_file = 'VGG_ILSVRC_16_layers.caffemodel'
  else
    error(string.format('Unrecognized model "%s"', name))
  end
  if path_offset then
    model_dir = paths.concat(path_offset, model_dir)
  end
  print('loading network weights from .. ' .. model_file)
  proto_file = paths.concat(model_dir, proto_file)
  model_file = paths.concat(model_dir, model_file)
  local cnn = loadcaffe.load(proto_file, model_file, backend)
  return net_utils.cudnn_tune_cnn(name, cnn)
end


-- Hardcode good cudnn v3 algorithms for different networks and GPUs.
-- We can't just run cudnn in benchmark mode because it will recompute
-- benchmarks for every new image size, which will be very slow; instead
-- we just pick some good algorithms for large images (800 x 600). They
-- might not be optimal for all image sizes but will probably be better
-- than the defaults.
local cudnn_algos = {}
cudnn_algos['vgg-16'] = {}
cudnn_algos['vgg-16']['GeForce GTX TITAN X'] = {
  [1] = {1, 0, 0},
  [3] = {1, 1, 0},
  [6] = {1, 1, 3},
  [8] = {1, 1, 3},
  [11] = {1, 1, 3},
  [13] = {1, 1, 3},
  [15] = {1, 1, 3},
  [18] = {1, 1, 3},
  [20] = {1, 1, 0},
  [22] = {1, 1, 0},
  [25] = {1, 1, 0},
  [27] = {1, 1, 0},
  [29] = {1, 1, 0},
}
--[[
-- These seeem to use too much memory =(
cudnn_algos['vgg-16']['GeForce GTX TITAN Z'] = {
  [1] = {0, 0, 1},
  [3] = {2, 1, 1},
  [6] = {1, 0, 3},
  [8] = {1, 1, 3},
  [11] = {1, 0, 0},
  [13] = {1, 0, 0},
  [15] = {1, 0, 0},
  [18] = {1, 0, 0},
  [20] = {1, 0, 0},
  [22] = {1, 0, 0},
  [25] = {1, 0, 3},
  [27] = {1, 0, 3},
  [29] = {1, 0, 3},
}
--]]


function net_utils.cudnn_tune_cnn(cnn_name, cnn)
  if not cutorch then
    return cnn
  end
  local device = cutorch.getDevice()
  local device_name = cutorch.getDeviceProperties(device).name
  if cudnn_algos[cnn_name] and cudnn_algos[cnn_name][device_name] then
    local algos = cudnn_algos[cnn_name][device_name]
    for i = 1, #cnn do
      local layer = cnn:get(i)
      if torch.isTypeOf(layer, 'cudnn.SpatialConvolution') and algos[i] then
        layer:setMode(unpack(algos[i]))
      end
    end
  end
  return cnn
end


--[[
Get a subsequence of a Sequential network.

Inputs:
- net: A nn.Sequential instance
- start_idx, end_idx: Start and end indices of the subsequence to get.
  Indices are inclusive.
--]]
function net_utils.subsequence(net, start_idx, end_idx)
  local seq = nn.Sequential()
  for i = start_idx, end_idx do
    seq:add(net:get(i))
  end
  return seq
end


function net_utils.compute_field_centers(net, end_idx)
  end_idx = end_idx or #net
  local x0, y0 = 1, 1
  local sx, sy = 1, 1
  for i = 1, end_idx do
    local layer = net:get(i)
    local t = torch.type(layer)
    if t == 'nn.SpatialConvolution' or
       t == 'nn.SpatialConvolutionMM' or 
       t == 'cudnn.SpatialConvolution' then
      local unit_stride = layer.dW == 1 and layer.dH == 1
      local same_x = math.floor(layer.kW / 2) == layer.padW
      local same_y = math.floor(layer.kH / 2) == layer.padH
      local same_conv = unit_stride and same_x and same_y
      if not same_conv then
        error('Cannot handle this type of conv layer')
      end
    elseif t == 'nn.ReLU' or t == 'cudnn.ReLU' then
      -- Do nothing
    elseif t == 'nn.SpatialMaxPooling' or
           t == 'cudnn.SpatialMaxPooling' then
      if layer.kW ~= 2 or layer.kH ~= 2 or
         layer.dW ~= 2 or layer.dH ~= 2 then
        error('Cannot handle this type of pooling layer')
      end
      x0 = x0 + sx / 2
      y0 = y0 + sy / 2
      sx = 2 * sx
      sy = 2 * sy
    else
      error(string.format('Cannot handle layer of type %s', t))
    end
  end
  return x0, y0, sx, sy
end


--[[
  Pick out named nodes from a nn.gModule. This can be used to extract
  parameters or activations from modules built with nngraph.
  Inputs:
  - gmod: A nn.gModule
  Returns:
  - name_to_mods: A table mapping node names to their Modules.
--]]
function net_utils.get_named_modules(gmod)
  local name_to_mods = {}
  for _, node in ipairs(gmod.forwardnodes) do
    if node.data.module then
      local node_name = node.data.annotations.name
      if node_name then
        -- assert(node_name, 'All nodes with parameters must be named')
        assert(name_to_mods[node_name] == nil, 'Node names must be unique')
        name_to_mods[node_name] = node.data.module
      end
    end
  end
  return name_to_mods
end

return net_utils
