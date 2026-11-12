# VisionGuard: 5-to-7 Minute College Team Presentation Script

**Project Title**: VisionGuard: AI-Powered Facial Access Control System  
**Team Structure**: 3 Presenters (Member 1, Member 2, Member 3)  
**Target Duration**: 6 minutes (+2 minutes live demonstration)

---

## 1. Opening & Problem Statement (0:00 – 1:15)

### Speaker: Member 3 (Frontend & Integration Lead)
> "Good morning, respected professors and evaluators. Today, our team is proud to present **VisionGuard: AI-Powered Facial Access Control System**.
>
> In today's hybrid work culture, professionals frequently work on confidential spreadsheets, medical records, source code, and banking data in public spaces—such as cafes, airport lounges, coworking spaces, and shared office environments.
>
> In cybersecurity, the most overlooked vulnerability is not network intrusion—it is **shoulder surfing**—where an unauthorized bystander physically looks at your laptop screen to steal credentials or sensitive corporate information.
>
> Traditional privacy screen filters are static, narrow viewing angles permanently, and cause severe eye strain. Our solution, **VisionGuard**, uses your laptop's standard webcam and client-side computer vision to monitor the visual environment around your workstation in real time. If an unauthorized person is detected looking directly toward your screen, VisionGuard instantly blurs the sensitive webpage content and triggers an automated privacy shield.
>
> Now, Member 1 will explain how our AI pipeline detects and recognizes faces."

---

## 2. Face Detection & Recognition Architecture (1:15 – 2:45)

### Speaker: Member 1 (Computer Vision & Biometrics Specialist)
> "Thank you, Member 3. When designing VisionGuard, our first technical priority was establishing a strict architectural separation between **Face Detection** and **Face Recognition**.
>
> In our pipeline, Face Detection answers the question: *'Where are the faces in the camera frame?'* We utilize a lightweight, depthwise-separable convolutional neural network—the Tiny Face Detector. It processes frames every 110 milliseconds, returning precise 2D bounding boxes and detection confidence scores with negligible CPU overhead.
>
> Once faces are located, our separate **Face Recognition** subsystem answers: *'Who is this person?'* 
>
> Rather than relying on simple pixel matching, we deploy a deep metric learning network based on a 34-layer ResNet architecture. This network projects the cropped, aligned facial features into a **128-dimensional Euclidean embedding space**.
>
> During the enrollment phase, the primary user captures 5 steady facial samples. We average these vectors and apply L2-normalization to create an immutable master template. 
>
> When the system is actively monitoring, candidate embeddings are compared against the master template using **Euclidean distance**. If the distance is less than 0.52, the identity is verified as the authorized user. If the distance exceeds 0.64, the person is classified as an unknown or unauthorized viewer.
>
> Crucially, from a privacy-by-design perspective, **no raw face photos or video streams are ever stored on disk or sent over the internet**. Only the 128 mathematical numbers are kept locally in the browser's origin-isolated storage.
>
> Next, Member 2 will explain our gaze estimation and security decision engine."

---

## 3. Gaze Estimation & Security Decision Logic (2:45 – 4:15)

### Speaker: Member 2 (Gaze & Security Engine Architect)
> "Thank you, Member 1. Detecting that another human being is standing behind you is not enough. If a coworker is simply walking by while looking at their phone, immediately locking the screen would cause constant false alarms and interrupt your workflow.
>
> Therefore, VisionGuard incorporates a dedicated **Gaze and Head Pose Estimation** component.
>
> To remain completely honest from an engineering standpoint: true laboratory-grade eye tracking requires specialized infrared illumination and corneal reflection sensors. In VisionGuard, we implement a mathematically sound, landmark-based geometric approximation.
>
> Using 68 2D facial landmarks, we calculate:
> 1. **Head Pose Yaw**: The horizontal offset of the nose tip relative to outer eye corners.
> 2. **Head Pose Pitch**: The vertical offset of the nose tip relative to the eye baseline and chin.
> 3. **Eye Aspect Ratio (EAR)**: Using Soukupová and Čech's metric to detect blinking and closed eyelids.
>
> If the subject's head yaw is within $\pm 22^\circ$ and pitch is within $\pm 18^\circ$ with eyes open, they are classified as `LOOKING_AT_SCREEN`. If their head is turned away, they are classified as `LOOKING_AWAY`. Gaze calculations are uniquely indexed to each face to eliminate cross-talk.
>
> These parameters feed into our **Security Decision Engine**, a deterministic state machine:
> - **SAFE**: Only the enrolled authorized user is in view.
> - **CAUTION**: An unrecognized face is visible, but looking away, or gaze is uncertain.
> - **PRIVACY ALERT**: An unauthorized person is detected looking directly toward the screen, confirmed across **4 consecutive frames**.
> - **NO USER DETECTED**: The user steps away for more than 2.8 seconds.
>
> To eliminate rapid screen flickering, we implemented **temporal confirmation windows** and a **2.4-second recovery cooldown** before restoring protected content.
>
> Now, Member 3 will demonstrate the live system."

---

## 4. Live Demonstration & Privacy Shield (4:15 – 5:30)

### Speaker: Member 3 (Integration Lead)
> "Thank you, Member 2. Let us now demonstrate VisionGuard running live on our laptop.
>
> *(Member 3 turns to laptop screen)*
>
> 1. **System Launch**: Here you see our cybersecurity dark-themed dashboard. Notice the header displays `READY`, confirming that the local neural network weights have loaded into the browser's WebGL context.
> 2. **Starting Monitoring**: I click *'Start Monitoring'*. The webcam feed activates. The Tiny Face Detector immediately places a green bounding box around Member 1's face with the tag `[AUTHORIZED] Primary User (Score: 95%, Distance: 0.31)`. The security state badge turns green: `SAFE`.
> 3. **Protected Content**: On the right, the mock confidential corporate ledger and asset keys are completely clear and accessible.
> 4. **Shoulder Surfer Attack Simulation**: Now, Member 2 steps behind Member 1. At first, Member 2 turns his head sideways. Notice the telemetry: the system transitions to `CAUTION` with an amber box `[UNKNOWN] Looking Away (Yaw: 34°)`. The sensitive content remains visible because Member 2 is not looking at the screen!
> 5. **Privacy Shield Activation**: Now, Member 2 turns his head to look directly at the laptop screen. Watch the frame confirmation counter: 1, 2, 3, 4—and instantly, the protected content blurs with a 22-pixel Gaussian filter! The red warning overlay appears: *'Privacy Shield Activated: Unauthorized Viewer Detected'*.
> 6. **Safe Recovery**: Member 2 steps away. Notice the engine enters recovery cooldown: it verifies safety for 2.4 continuous seconds before smoothly unblurring the confidential ledger.
> 7. **Stopping Stream**: When I click *'Stop Monitoring'*, the camera tracks are completely stopped and released."

---

## 5. Limitations & Conclusion (5:30 – 6:30)

### Speaker: Member 1 & Member 3
> **Member 1**: "Finally, we want to address our architectural scope. Because VisionGuard runs within the browser sandbox, it can blur **only its own webpage content**. Protecting external applications like Word or the desktop OS would require a native desktop service or browser extension—which represents our planned future scope."
>
> **Member 3**: "In conclusion, VisionGuard delivers a zero-trust, privacy-by-design access control solution that is 100% functional, runs offline with zero server dependencies, and protects sensitive visual data.
>
> Thank you. We are now ready for your questions."

---

## Post-Presentation Likely Q&A Preparation

1. **Professor**: *"What is the frame rate of your AI pipeline?"*  
   **Answer (Member 2)**: *"We run detection and landmark inference at 110ms intervals, giving approximately 9 to 10 AI evaluations per second. Meanwhile, the UI and camera preview render at a smooth 30 to 60 FPS using requestAnimationFrame."*

2. **Professor**: *"Why did you use Euclidean distance instead of Cosine similarity?"*  
   **Answer (Member 1)**: *"Because we L2-normalize our 128-dimensional embedding vectors during enrollment, Euclidean distance squared is directly proportional to Cosine distance: $d^2 = 2 - 2 \cos(\theta)$. Euclidean distance is computationally faster and natively supported by standard metric learning benchmarks."*

3. **Professor**: *"What happens if the camera is covered or fails?"*  
   **Answer (Member 2)**: *"Our engine enforces a strict security invariant: a camera or model failure immediately transitions the system into `CAMERA_ERROR` or `MODEL_ERROR`. It is a fundamental design rule that system errors never default to SAFE."*
