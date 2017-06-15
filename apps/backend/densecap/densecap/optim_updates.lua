
function sgd(x, dx, lr)
  x:add(-lr, dx)
end


function sgdm(x, dx, lr, alpha, state)
  -- sgd with momentum, standard update
  if not state.v then
    state.v = x.new(#x):zero()
  end
  state.v:mul(alpha)
  state.v:add(lr, dx)
  x:add(-1, state.v)
end


function sgdmom(x, dx, lr, alpha, state)
  -- sgd momentum, uses nesterov update (reference: http://cs231n.github.io/neural-networks-3/#sgd)
  if not state.m then
    state.m = x.new(#x):zero()
    state.tmp = x.new(#x)
  end
  state.tmp:copy(state.m)
  state.m:mul(alpha):add(-lr, dx)
  x:add(-alpha, state.tmp)
  x:add(1+alpha, state.m)
end

function adagrad(x, dx, lr, epsilon, state)
  if not state.m then
    state.m = x.new(#x):zero()
    state.tmp = x.new(#x)
  end
  -- calculate new mean squared values
  state.m:addcmul(1.0, dx, dx)
  -- perform update
  state.tmp:sqrt(state.m):add(epsilon)
  x:addcdiv(-lr, dx, state.tmp)
end

-- rmsprop implementation, simple as it should be
function rmsprop(x, dx, lr, alpha, epsilon, state)
  if not state.m then
    state.m = x.new(#x):zero()
    state.tmp = x.new(#x)
  end
  -- calculate new (leaky) mean squared values
  state.m:mul(alpha)
  state.m:addcmul(1.0-alpha, dx, dx)
  -- perform update
  state.tmp:sqrt(state.m):add(epsilon)
  x:addcdiv(-lr, dx, state.tmp)
end

function adam(x, dx, lr, beta1, beta2, epsilon, state)
  local beta1 = beta1 or 0.9
  local beta2 = beta2 or 0.999
  local epsilon = epsilon or 1e-8

  if not state.m then
    -- Initialization
    state.t = 0
    -- Exponential moving average of gradient values
    state.m = x.new(#dx):zero()
    -- Exponential moving average of squared gradient values
    state.v = x.new(#dx):zero()
    -- A tmp tensor to hold the sqrt(v) + epsilon
    state.tmp = x.new(#dx):zero()
  end

  -- Decay the first and second moment running average coefficient
  state.m:mul(beta1):add(1-beta1, dx)
  state.v:mul(beta2):addcmul(1-beta2, dx, dx)
  state.tmp:copy(state.v):sqrt():add(epsilon)

  state.t = state.t + 1
  local biasCorrection1 = 1 - beta1^state.t
  local biasCorrection2 = 1 - beta2^state.t
  local stepSize = lr * math.sqrt(biasCorrection2)/biasCorrection1
  
  -- perform update
  x:addcdiv(-stepSize, state.m, state.tmp)
end
