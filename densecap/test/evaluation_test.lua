
local eval_utils = require 'eval.eval_utils'
local utils = require 'densecap.utils'

local tests = torch.TestSuite()
local tester = torch.Tester()

function tests.sanityCheckTest()

  local records = {}
  table.insert(records, {references={'an example ref', 'another ref', 'and one more'}, candidate='one words matches'})
  table.insert(records, {references={'some sentence', 'one more for fun'}, candidate='nothing matches'})
  table.insert(records, {references={'expecting perfect match', 'garbage sent', 'bleh one more'}, candidate='expecting perfect match'})

  local blob = eval_utils.score_captions(records)
  local scores = blob.scores

  tester:asserteq(#scores, 3)
  tester:assertgt(scores[1], 0.0)
  tester:assertlt(scores[1], 1.0)
  tester:asserteq(scores[2], 0, 'nothing should match')
  tester:asserteq(scores[3], 1.0, 'exact match expected')
  tester:assertgt(blob.average_score, 0.0, 'average score between 0 and 1')
  tester:assertlt(blob.average_score, 1.0, 'average score between 0 and 1')
end

function tests.evaluatorTest()
  -- run short test on DenseCapEvaluator to make sure it doesn't crash or something
  
  local evaluator = DenseCaptioningEvaluator()

  local B = 10
  local M = 5
  local logprobs = torch.randn(B,2)
  local boxes = torch.rand(B,4)
  local text = {"hello there", "how are you", "this is a string",
               "this string is a bit longer", "short one", "another prediction", 
               "this is the 7th item", "here is an item", "one more", "last prediction"}
  local target_boxes = torch.rand(M,4)
  local target_text = {"one ground truth", "another one", "short", "fourth gt", "how are you"}
  -- add to evaluator
  evaluator:addResult(logprobs, boxes, text, target_boxes, target_text)

  local B = 7
  local M = 4
  local logprobs = torch.randn(B,2)
  local boxes = torch.rand(B,4)
  local text = {"hello there number two", "how are you", "this is a string",
               "this string is a bit longer", "short one", "another prediction", 
               "this is the 7th item lol"}
  local target_boxes = torch.rand(M,4)
  local target_text = {"one ground truth", "one two three", "short", "fourth gt"}
  -- add again evaluator
  evaluator:addResult(logprobs, boxes, text, target_boxes, target_text)

  local results = evaluator:evaluate()
  print(results)

end

tester:add(tests)
tester:run()
