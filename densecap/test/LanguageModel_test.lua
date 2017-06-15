require 'densecap.LanguageModel'

local tests = torch.TestSuite()
local tester = torch.Tester()


local function check_dims(t, dims)
  tester:assert(t:dim() == #dims)
  for i = 1, #dims do
    tester:assert(t:size(i) == dims[i])
  end
end


function simpleTest(dtype)
  return function()
    if dtype == 'torch.CudaTensor' then
      require 'cutorch'
      require 'cunn'
    end
    
    local D, W, H, V, T = 512, 64, 128, 5, 10
    local lm = nn.LanguageModel{
      vocab_size=V,
      input_encoding_size=W,
      image_vector_dim=D,
      rnn_size=H,
      seq_length=T,
      idx_to_token={},
    }:type(dtype)
    
    local N = 20
    local image_vecs = torch.randn(N, D):type(dtype)
    local gt_seq = torch.LongTensor(N, T):random(V+1):add(-1)

    local out = lm:forward{image_vecs, gt_seq}
    check_dims(out, {N, T + 2, V + 1})
  end
end


tests.simpleTestFloat = simpleTest('torch.FloatTensor')
tests.simpleTestCuda = simpleTest('torch.CudaTensor')


function tests.getTargetTest()
  local D, W, H, V, T = 512, 64, 128, 100, 5
  local lm = nn.LanguageModel{
    vocab_size=V,
    input_encoding_size=W,
    image_vector_dim=D,
    rnn_size=H,
    seq_length=T,
    idx_to_token={},
  }
  local N = 4
  local gt_sequence = torch.LongTensor{
    {5, 7, 0, 0, 0},
    {11, 12, 13, 0, 0},
    {15, 16, 17, 18, 29},
    {50, 0, 0, 0, 0}
  }
  local target = lm:getTarget(gt_sequence)
  local expected_target = torch.LongTensor{
    {0, 5, 7, 101, 0, 0, 0},
    {0, 11, 12, 13, 101, 0, 0},
    {0, 15, 16, 17, 18, 29, 101},
    {0, 50, 101, 0, 0, 0, 0}
  }
  tester:assertTensorEq(target, expected_target, 0)
end


function sampleTest(dtype)
  return function()
    if dtype == 'torch.CudaTensor' then
      require 'cutorch'
      require 'cunn'
    end
    
    local D, W, H, V, T = 512, 64, 128, 5, 10
    local lm = nn.LanguageModel{
      vocab_size=V,
      input_encoding_size=W,
      image_vector_dim=D,
      rnn_size=H,
      seq_length=T,
      idx_to_token={},
    }
    lm:type(dtype)
    
    local N = 20
    local image_vecs = torch.randn(N, D):type(dtype)
    
    local out = lm:forward{image_vecs, image_vecs.new()}
    check_dims(out, {N, T})
  end
end

tests.sampleTestCuda = sampleTest('torch.CudaTensor')
tests.sampleTestFloat = sampleTest('torch.FloatTensor')


function beamSearchTest(dtype)
  return function()
    if dtype == 'torch.CudaTensor' then
      require 'cutorch'
      require 'cunn'
    end

    local D, W, H, V, T = 512, 64, 128, 15, 10
    local lm = nn.LanguageModel{
      vocab_size=V,
      input_encoding_size=W,
      image_vector_dim=D,
      rnn_size=H,
      seq_length=T,
      idx_to_token={},
    }
    lm:type(dtype)

    local N = 12
    local image_vecs = torch.randn(N, D):type(dtype)

    local beam_size = 7
    local out = lm:beamsearch(image_vecs, beam_size)
    print(out)
  end
end

tests.beamSearchTestFloat = beamSearchTest('torch.FloatTensor')
tests.beamSearchTestCuda = beamSearchTest('torch.CudaTensor')


function tests.decodeSequenceTest()
  local idx_to_token = {'a', 'cat', 'dog', 'eating', 'hungry'}
  local D, W, H, V, T = 512, 64, 128, 5, 10
  local lm = nn.LanguageModel{
    vocab_size=V,
    input_encoding_size=W,
    image_vector_dim=D,
    rnn_size=H,
    seq_length=T,
    idx_to_token=idx_to_token,
  }
  
  local seq = torch.LongTensor{
    {1, 5, 2, 4, 1, 3, 6},
    {1, 3, 6, 0, 0, 0, 0},
    {2, 3, 1, 3, 2, 6, 0},
  }
  
  local captions = lm:decodeSequence(seq)
  local expected_captions = {
    'a hungry cat eating a dog',
    'a dog',
    'cat dog a dog cat',
  }
  tester:assertTableEq(captions, expected_captions)
end


tester:add(tests)
tester:run()
