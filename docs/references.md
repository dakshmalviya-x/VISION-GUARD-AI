# VisionGuard: Scientific References, Citations & Glossary

## 1. Academic & Technical References

1. **FaceNet: A Unified Embedding for Face Recognition and Clustering**
   - *Authors*: Florian Schroff, Dmitry Kalenichenko, James Philbin (Google Inc.)
   - *Publication*: IEEE Conference on Computer Vision and Pattern Recognition (CVPR), 2015.
   - *Relevance*: Introduces deep metric learning with triplet loss to map facial images directly to Euclidean space embeddings where distance represents facial similarity.

2. **Real-Time Eye Blink Detection using Facial Landmarks**
   - *Authors*: Tereza Soukupová and Jan Čech (Center for Machine Perception, Czech Technical University)
   - *Publication*: 21st Computer Vision Winter Workshop (CVWW), 2016.
   - *Relevance*: Introduces the Eye Aspect Ratio (EAR) metric used in VisionGuard to detect blinking, eye closure, and squinting from 6 2D eye landmarks.

3. **Deep Residual Learning for Image Recognition**
   - *Authors*: Kaiming He, Xiangyu Zhang, Shaoqing Ren, Jian Sun (Microsoft Research)
   - *Publication*: IEEE Conference on Computer Vision and Pattern Recognition (CVPR), 2016.
   - *Relevance*: The 34-layer ResNet architecture utilized by the face recognition feature extraction network.

4. **MobileNets: Efficient Convolutional Neural Networks for Mobile Vision Applications**
   - *Authors*: Andrew G. Howard et al. (Google Research)
   - *Publication*: arXiv:1704.04861, 2017.
   - *Relevance*: Introduces depthwise separable convolutions that power the real-time Tiny Face Detector and SSD MobileNet models.

5. **One Millisecond Face Alignment with an Ensemble of Regression Trees**
   - *Authors*: Vahid Kazemi and Josephine Sullivan (KTH Royal Institute of Technology)
   - *Publication*: IEEE CVPR, 2014.
   - *Relevance*: Landmark regressor foundations utilized to locate 68 2D facial landmarks in real-time.

---

## 2. Open-Source Libraries, APIs & Model Licenses

| Component | Repository / Provider | License | Role in VisionGuard |
|---|---|---|---|
| **@vladmandic/face-api** | [github.com/vladmandic/face-api](https://github.com/vladmandic/face-api) | MIT License | TensorFlow.js v4+ wrapper providing browser inference for face detection, 68 landmarks, and 128-d descriptors. |
| **face-api.js** | [github.com/justadudewhohacks/face-api.js](https://github.com/justadudewhohacks/face-api.js) | MIT License | Original JavaScript implementation of face recognition models in the browser. |
| **TensorFlow.js** | [tensorflow.org/js](https://www.tensorflow.org/js) | Apache License 2.0 | Core machine learning tensor engine utilizing WebGL backend acceleration. |
| **W3C Media Capture & Streams** | [w3.org/TR/mediacapture-streams](https://www.w3.org/TR/mediacapture-streams/) | W3C Standard | Standard browser API (`navigator.mediaDevices.getUserMedia`) for accessing laptop webcam hardware. |

---

## 3. Glossary of Essential Terminology

- **Biometric Embedding**: A compact floating-point vector (128 dimensions in VisionGuard) output by a deep neural network where spatial proximity reflects biometric similarity.
- **Bounding Box**: A 2D rectangular box defined by coordinates `[x, y, width, height]` demarcating the detected location of an object or face in an image.
- **Deep Metric Learning**: An approach to machine learning where a model is trained directly to learn a distance metric in feature space, pulling matching pairs close and pushing non-matching pairs apart.
- **Euclidean Distance**: The straight-line geometric distance between two vectors in n-dimensional Euclidean space: $d(\vec{u}, \vec{v}) = \sqrt{\sum (u_i - v_i)^2}$.
- **Eye Aspect Ratio (EAR)**: The ratio of vertical eye aperture to horizontal eye span calculated across 6 specific eyelid landmarks.
- **Head Pose (Yaw, Pitch, Roll)**: The 3D angular orientation of the human head. Yaw denotes horizontal rotation (left/right), Pitch denotes vertical tilt (up/down), and Roll denotes lateral tilt (ear toward shoulder).
- **Hysteresis / Recovery Cooldown**: A technique in control systems and state machines where the transition back to an initial state requires a sustained verification duration, preventing rapid flickering.
- **L2-Normalization**: Scaling a vector such that its Euclidean norm (magnitude) equals 1.0: $\vec{v}_{\text{norm}} = \vec{v} / \|\vec{v}\|_2$.
- **Shoulder Surfing**: The physical act of looking over someone's shoulder or observing their workstation screen to obtain sensitive information without authorization.
- **WebGL**: Web Graphics Library; a JavaScript API for rendering interactive 2D and 3D graphics within any compatible web browser without plug-ins, utilized here for GPU-accelerated tensor computations.
