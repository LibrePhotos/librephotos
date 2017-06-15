#!/usr/bin/env python

# Python wrapper for METEOR implementation, by Xinlei Chen
# Acknowledge Michael Denkowski for the generous discussion and help 
# Code adjusted by Andrej Karpathy

import os
import sys
import subprocess
import threading

# Assumes meteor-1.5.jar is in the same directory as meteor.py.  Change as needed.
ABSPATH = os.path.dirname(os.path.abspath(__file__))
METEOR_JAR = os.path.join(ABSPATH, 'meteor-1.5.jar')

class Meteor(object):

    def __init__(self):
        self.meteor_cmd = ['java', '-jar', '-Xmx2G', METEOR_JAR, \
                '-', '-', '-stdio', '-l', 'en', '-norm']
        self.meteor_p = subprocess.Popen(self.meteor_cmd, \
                cwd=ABSPATH, \
                stdin=subprocess.PIPE, \
                stdout=subprocess.PIPE, \
                stderr=subprocess.PIPE)
        self.lock = threading.Lock() # Used to guarantee thread safety

    def _score(self, hypothesis_str, reference_list):
        self.lock.acquire()
        # SCORE ||| reference 1 words ||| reference n words ||| hypothesis words
        hypothesis_str = hypothesis_str.replace('|||','').replace('  ',' ')
        score_line = ' ||| '.join(('SCORE', ' ||| '.join(reference_list), hypothesis_str))
        w = '{}\n'.format(score_line)
        self.meteor_p.stdin.write(w)
        stats = self.meteor_p.stdout.readline().strip()
        
        eval_line = 'EVAL ||| {}'.format(stats)
        w = '{}\n'.format(eval_line)
        self.meteor_p.stdin.write(w)
        r = self.meteor_p.stdout.readline().strip()
        score = float(r)
        # I don't know why we were reading out twice? That doesn't work
        # r = self.meteor_p.stdout.readline().strip()
        # print 'got second line of EVAL results:'
        # score = float(r) # have to read out twice
        # print r, score
        self.lock.release()
        return score
 
    def __exit__(self):
        self.lock.acquire()
        self.meteor_p.stdin.close()
        self.meteor_p.wait()
        self.lock.release()

if __name__ == "__main__":

    assert os.path.isfile(METEOR_JAR), 'you must have meteor-1.5.jar! Check README.md instructions in eval/ folder.'

    jobid = sys.argv[1] if len(sys.argv) >= 2 else ''
    INPUT_FILE = os.path.join(ABSPATH, 'input%s.json' % (jobid, ))
    OUTPUT_FILE = os.path.join(ABSPATH, 'output%s.json' % (jobid, ))    

    m = Meteor()
    import json
    records = json.load(open(INPUT_FILE, 'r'))
    scores = []
    for r in records:
        score = m._score(r['candidate'], r['references'])
        scores.append(score)

    out = {}
    out['scores'] = scores
    out['average_score'] = sum(scores) / len(scores)
    json.dump(out, open(OUTPUT_FILE, 'w'))
