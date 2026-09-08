// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// Converted to TypeScript from Kimodo definitions.py and joints.p; positions rounded to 9 decimals.
// Source revision: 1aece8c124d73d255ceff5086d983b844c9f4e94. Units: meters, Y up, root-relative.
export const SOMA77 = [
  {
    "name": "Hips",
    "parent": null,
    "position": [
      0,
      0,
      0
    ]
  },
  {
    "name": "Spine1",
    "parent": "Hips",
    "position": [
      -0.00013727,
      0.050037626,
      -0.000537267
    ]
  },
  {
    "name": "Spine2",
    "parent": "Spine1",
    "position": [
      -0.000137272,
      0.12129064,
      -0.000835515
    ]
  },
  {
    "name": "Chest",
    "parent": "Spine2",
    "position": [
      -0.000137278,
      0.19679127,
      -0.008995225
    ]
  },
  {
    "name": "Neck1",
    "parent": "Chest",
    "position": [
      -0.001954043,
      0.459904223,
      -0.014528708
    ]
  },
  {
    "name": "Neck2",
    "parent": "Neck1",
    "position": [
      -0.001954071,
      0.536998189,
      0.008497147
    ]
  },
  {
    "name": "Head",
    "parent": "Neck2",
    "position": [
      -0.001954117,
      0.598287348,
      0.028034233
    ]
  },
  {
    "name": "HeadEnd",
    "parent": "Head",
    "position": [
      -0.001918138,
      0.758941373,
      0.00968044
    ]
  },
  {
    "name": "Jaw",
    "parent": "Head",
    "position": [
      -0.001927748,
      0.603043271,
      0.058983639
    ]
  },
  {
    "name": "LeftEye",
    "parent": "Head",
    "position": [
      0.030109691,
      0.6520894,
      0.103903063
    ]
  },
  {
    "name": "RightEye",
    "parent": "Head",
    "position": [
      -0.034178519,
      0.651906039,
      0.103616569
    ]
  },
  {
    "name": "LeftShoulder",
    "parent": "Chest",
    "position": [
      0.01607924,
      0.429162911,
      0.042138907
    ]
  },
  {
    "name": "LeftArm",
    "parent": "LeftShoulder",
    "position": [
      0.165277697,
      0.429162933,
      -0.01288435
    ]
  },
  {
    "name": "LeftForeArm",
    "parent": "LeftArm",
    "position": [
      0.452670775,
      0.429162935,
      -0.012910229
    ]
  },
  {
    "name": "LeftHand",
    "parent": "LeftForeArm",
    "position": [
      0.723610587,
      0.429162928,
      -0.012884139
    ]
  },
  {
    "name": "LeftHandThumb1",
    "parent": "LeftHand",
    "position": [
      0.746375406,
      0.415242476,
      0.019029991
    ]
  },
  {
    "name": "LeftHandThumb2",
    "parent": "LeftHandThumb1",
    "position": [
      0.786503772,
      0.396961209,
      0.035446534
    ]
  },
  {
    "name": "LeftHandThumb3",
    "parent": "LeftHandThumb2",
    "position": [
      0.814488923,
      0.39696121,
      0.035446506
    ]
  },
  {
    "name": "LeftHandThumbEnd",
    "parent": "LeftHandThumb3",
    "position": [
      0.846296854,
      0.396961171,
      0.035446548
    ]
  },
  {
    "name": "LeftHandIndex1",
    "parent": "LeftHand",
    "position": [
      0.756086135,
      0.42384295,
      0.010077553
    ]
  },
  {
    "name": "LeftHandIndex2",
    "parent": "LeftHandIndex1",
    "position": [
      0.819731918,
      0.423963547,
      0.011863549
    ]
  },
  {
    "name": "LeftHandIndex3",
    "parent": "LeftHandIndex2",
    "position": [
      0.856355558,
      0.423963548,
      0.011863551
    ]
  },
  {
    "name": "LeftHandIndex4",
    "parent": "LeftHandIndex3",
    "position": [
      0.879647978,
      0.423963588,
      0.011863592
    ]
  },
  {
    "name": "LeftHandIndexEnd",
    "parent": "LeftHandIndex4",
    "position": [
      0.90724413,
      0.422158213,
      0.010733352
    ]
  },
  {
    "name": "LeftHandMiddle1",
    "parent": "LeftHand",
    "position": [
      0.755245538,
      0.431572733,
      -0.002880817
    ]
  },
  {
    "name": "LeftHandMiddle2",
    "parent": "LeftHandMiddle1",
    "position": [
      0.817153337,
      0.428979951,
      -0.012906298
    ]
  },
  {
    "name": "LeftHandMiddle3",
    "parent": "LeftHandMiddle2",
    "position": [
      0.860718538,
      0.428979912,
      -0.012906306
    ]
  },
  {
    "name": "LeftHandMiddle4",
    "parent": "LeftHandMiddle3",
    "position": [
      0.890687309,
      0.428979833,
      -0.012906304
    ]
  },
  {
    "name": "LeftHandMiddleEnd",
    "parent": "LeftHandMiddle4",
    "position": [
      0.913730182,
      0.426034144,
      -0.01322371
    ]
  },
  {
    "name": "LeftHandRing1",
    "parent": "LeftHand",
    "position": [
      0.752437018,
      0.428626408,
      -0.016109571
    ]
  },
  {
    "name": "LeftHandRing2",
    "parent": "LeftHandRing1",
    "position": [
      0.810982428,
      0.423764384,
      -0.029847978
    ]
  },
  {
    "name": "LeftHandRing3",
    "parent": "LeftHandRing2",
    "position": [
      0.85448821,
      0.423764385,
      -0.029847945
    ]
  },
  {
    "name": "LeftHandRing4",
    "parent": "LeftHandRing3",
    "position": [
      0.881001421,
      0.423764455,
      -0.029847924
    ]
  },
  {
    "name": "LeftHandRingEnd",
    "parent": "LeftHandRing4",
    "position": [
      0.900362473,
      0.424541323,
      -0.029848631
    ]
  },
  {
    "name": "LeftHandPinky1",
    "parent": "LeftHand",
    "position": [
      0.752265585,
      0.426062876,
      -0.028887918
    ]
  },
  {
    "name": "LeftHandPinky2",
    "parent": "LeftHandPinky1",
    "position": [
      0.803144072,
      0.412751463,
      -0.04660022
    ]
  },
  {
    "name": "LeftHandPinky3",
    "parent": "LeftHandPinky2",
    "position": [
      0.833853812,
      0.412751503,
      -0.046600217
    ]
  },
  {
    "name": "LeftHandPinky4",
    "parent": "LeftHandPinky3",
    "position": [
      0.849350533,
      0.412751504,
      -0.046600205
    ]
  },
  {
    "name": "LeftHandPinkyEnd",
    "parent": "LeftHandPinky4",
    "position": [
      0.868799463,
      0.411173483,
      -0.04602802
    ]
  },
  {
    "name": "RightShoulder",
    "parent": "Chest",
    "position": [
      -0.01393846,
      0.428594356,
      0.043146353
    ]
  },
  {
    "name": "RightArm",
    "parent": "RightShoulder",
    "position": [
      -0.164310422,
      0.428594473,
      -0.01230969
    ]
  },
  {
    "name": "RightForeArm",
    "parent": "RightArm",
    "position": [
      -0.451676815,
      0.428594492,
      -0.012335661
    ]
  },
  {
    "name": "RightHand",
    "parent": "RightForeArm",
    "position": [
      -0.723013013,
      0.428594491,
      -0.012309534
    ]
  },
  {
    "name": "RightHandThumb1",
    "parent": "RightHand",
    "position": [
      -0.745753331,
      0.414754607,
      0.019321738
    ]
  },
  {
    "name": "RightHandThumb2",
    "parent": "RightHandThumb1",
    "position": [
      -0.785867624,
      0.396479942,
      0.03573088
    ]
  },
  {
    "name": "RightHandThumb3",
    "parent": "RightHandThumb2",
    "position": [
      -0.813816975,
      0.396479904,
      0.035730848
    ]
  },
  {
    "name": "RightHandThumbEnd",
    "parent": "RightHandThumb3",
    "position": [
      -0.845655496,
      0.396479946,
      0.035730856
    ]
  },
  {
    "name": "RightHandIndex1",
    "parent": "RightHand",
    "position": [
      -0.755545671,
      0.423393918,
      0.010519127
    ]
  },
  {
    "name": "RightHandIndex2",
    "parent": "RightHandIndex1",
    "position": [
      -0.818964842,
      0.423518626,
      0.012301785
    ]
  },
  {
    "name": "RightHandIndex3",
    "parent": "RightHandIndex2",
    "position": [
      -0.855513552,
      0.423518547,
      0.012301783
    ]
  },
  {
    "name": "RightHandIndex4",
    "parent": "RightHandIndex3",
    "position": [
      -0.878789413,
      0.423518548,
      0.012301792
    ]
  },
  {
    "name": "RightHandIndexEnd",
    "parent": "RightHandIndex4",
    "position": [
      -0.906407311,
      0.421711992,
      0.011171014
    ]
  },
  {
    "name": "RightHandMiddle1",
    "parent": "RightHand",
    "position": [
      -0.754694071,
      0.431060425,
      -0.00229923
    ]
  },
  {
    "name": "RightHandMiddle2",
    "parent": "RightHandMiddle1",
    "position": [
      -0.816502349,
      0.42847207,
      -0.012308183
    ]
  },
  {
    "name": "RightHandMiddle3",
    "parent": "RightHandMiddle2",
    "position": [
      -0.85999136,
      0.428472071,
      -0.012308184
    ]
  },
  {
    "name": "RightHandMiddle4",
    "parent": "RightHandMiddle3",
    "position": [
      -0.889993761,
      0.428472032,
      -0.012308206
    ]
  },
  {
    "name": "RightHandMiddleEnd",
    "parent": "RightHandMiddle4",
    "position": [
      -0.913018958,
      0.425528335,
      -0.012625269
    ]
  },
  {
    "name": "RightHandRing1",
    "parent": "RightHand",
    "position": [
      -0.751869913,
      0.427914968,
      -0.015398117
    ]
  },
  {
    "name": "RightHandRing2",
    "parent": "RightHandRing1",
    "position": [
      -0.810411899,
      0.423053666,
      -0.029135426
    ]
  },
  {
    "name": "RightHandRing3",
    "parent": "RightHandRing2",
    "position": [
      -0.8538,
      0.423053627,
      -0.029135428
    ]
  },
  {
    "name": "RightHandRing4",
    "parent": "RightHandRing3",
    "position": [
      -0.88034903,
      0.423053588,
      -0.029135389
    ]
  },
  {
    "name": "RightHandRingEnd",
    "parent": "RightHandRing4",
    "position": [
      -0.899684714,
      0.423828853,
      -0.029135914
    ]
  },
  {
    "name": "RightHandPinky1",
    "parent": "RightHand",
    "position": [
      -0.751677265,
      0.425166527,
      -0.028150983
    ]
  },
  {
    "name": "RightHandPinky2",
    "parent": "RightHandPinky1",
    "position": [
      -0.802590975,
      0.411845972,
      -0.045874828
    ]
  },
  {
    "name": "RightHandPinky3",
    "parent": "RightHandPinky2",
    "position": [
      -0.833217616,
      0.411845934,
      -0.04587482
    ]
  },
  {
    "name": "RightHandPinky4",
    "parent": "RightHandPinky3",
    "position": [
      -0.848682906,
      0.411845975,
      -0.04587484
    ]
  },
  {
    "name": "RightHandPinkyEnd",
    "parent": "RightHandPinky4",
    "position": [
      -0.868134096,
      0.410268797,
      -0.045302729
    ]
  },
  {
    "name": "LeftLeg",
    "parent": "Hips",
    "position": [
      0.10043214,
      -0.084345267,
      0.025956547
    ]
  },
  {
    "name": "LeftShin",
    "parent": "LeftLeg",
    "position": [
      0.10043213,
      -0.516562804,
      0.017927419
    ]
  },
  {
    "name": "LeftFoot",
    "parent": "LeftShin",
    "position": [
      0.10043214,
      -0.938113763,
      -0.01688781
    ]
  },
  {
    "name": "LeftToeBase",
    "parent": "LeftFoot",
    "position": [
      0.10043214,
      -0.988708484,
      0.115427483
    ]
  },
  {
    "name": "LeftToeEnd",
    "parent": "LeftToeBase",
    "position": [
      0.100336074,
      -1.005184675,
      0.180557655
    ]
  },
  {
    "name": "RightLeg",
    "parent": "Hips",
    "position": [
      -0.10047278,
      -0.0829526,
      0.02620317
    ]
  },
  {
    "name": "RightShin",
    "parent": "RightLeg",
    "position": [
      -0.10047277,
      -0.516574659,
      0.018147611
    ]
  },
  {
    "name": "RightFoot",
    "parent": "RightShin",
    "position": [
      -0.10047275,
      -0.937748602,
      -0.016636367
    ]
  },
  {
    "name": "RightToeBase",
    "parent": "RightFoot",
    "position": [
      -0.100472753,
      -0.988544695,
      0.116205588
    ]
  },
  {
    "name": "RightToeEnd",
    "parent": "RightToeBase",
    "position": [
      -0.100377437,
      -1.004888476,
      0.180811501
    ]
  }
] as const;
