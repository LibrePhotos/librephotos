from darknetpy.detector import Detector
import gc

def detect_objects(image_path):
    detector = Detector('/code/api/yolo/yolo-9000/darknet/cfg/combine9k.data',
                        '/code/api/yolo/yolo-9000/darknet/cfg/yolo9000.cfg', 
                        '/code/api/yolo/yolo-9000/yolo9000-weights/yolo9000.weights')
    result = detector.detect(image_path)
    #kill darknet yolo process
    gc.collect()
    return result
