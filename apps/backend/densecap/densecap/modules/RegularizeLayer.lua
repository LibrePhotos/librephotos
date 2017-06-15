local RegularizeLayer, parent = torch.class('nn.RegularizeLayer','nn.Module')

-- acts as inplace regularizer, and also can scale gradients
function RegularizeLayer:__init(weight, gradMul)
    parent.__init(self)
    assert(weight ~= nil, 'RegularizeLayer needs its weight passed in')
    self.w = weight
    self.gradMul = gradMul or 1.0
end
    
function RegularizeLayer:updateOutput(input)
    local loss = 0.5 * self.w * torch.pow(input:norm(2), 2)
    self.loss = loss  
    self.output = input -- noop forward
    return self.output 
end

function RegularizeLayer:updateGradInput(input, gradOutput)
    self.gradInput:resizeAs(input):copy(input):mul(self.w)
    self.gradInput:add(self.gradMul, gradOutput)
    return self.gradInput 
end
