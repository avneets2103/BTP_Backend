import { Router } from "express";
import { 
    registerLoginUser,
    verifyOTP,
    resendOTP,
    generateNewPassword,
    refreshAccessToken,
    verifyAccessToken,
    logoutUser,
    changeCurrentPassword,
    deleteUserByEmail,
    setDoctor,
    getUserData,
    savePatientDetails,
    profilePhotoUploadSignedURL,
    getAllUsers,
    updatePassword
 } from "../Controllers/user.controller.mjs";
import { verifyJWT } from "../Middlewares/auth.middleware.mjs";

const router = Router();

router.route("/login").post(registerLoginUser);
router.route("/verifyOTP").post(verifyOTP);
router.route("/resendOTP").post(resendOTP);
router.route("/generateNewPassword").post(generateNewPassword);
router.route("/refreshAccessToken").post(refreshAccessToken);
router.route("/setDoctor").post(setDoctor);
router.route("/deleteUser").post(deleteUserByEmail);
router.route("/getAllUsers").post(getAllUsers);

// secured routs
router.route("/verifyAccessToken").post(verifyJWT, verifyAccessToken);
router.route("/logout").post(verifyJWT, logoutUser);
router.route("/changePassword").post(verifyJWT, changeCurrentPassword);
router.route("/getUserData").post(verifyJWT, getUserData);
router.route("/savePatientDetails").post(verifyJWT, savePatientDetails);
router.route("/profilePhotoUploadSignedURL").post(verifyJWT, profilePhotoUploadSignedURL);
router.route("/updatePassword").post(verifyJWT, updatePassword);

export default router;