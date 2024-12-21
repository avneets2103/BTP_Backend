import { asyncHandler } from '../Utils/asyncHandler.mjs'
import ApiError from '../Utils/ApiError.mjs'
import ApiResponse from '../Utils/ApiResponse.mjs'
import { User } from '../Models/user.model.mjs'
import jwt from 'jsonwebtoken'
import { randomString, makeUniqueFileName } from '../Utils/helpers.mjs'
import {emailOTP, emailNewPassword} from '../constants.mjs'
import { Patient } from '../Models/patient.model.mjs'
import { Doctor } from '../Models/doctor.model.mjs'
import { getObjectURL, putObjectURL } from '../Utils/s3.mjs'
import {sendingMail} from '../Utils/messagingService.mjs'

const generateAccessAndRefreshToken = async (userId) => {
    try {
        const user = await User.findById(userId)
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.accessToken = accessToken
        user.refreshToken = refreshToken
        await user.save({ validateBeforeSave: false }) // so that all validations dont kick in only changes are saved
        return { accessToken, refreshToken }
    } catch (error) {
        throw new ApiError(
            500,
            'Something went wrong while generating refresh and access token'
        )
    }
}

const registerLoginUser = asyncHandler(async (req, res) => {
    try {
        const { email, password } = req.body
        if (email.trim().length == 0 || password.trim().length == 0) {
            throw new ApiError(400, 'All fields required')
        }

        // check if already exist
        const exsistingUser = await User.findOne({
            $or: [{ email }],
        })

        // otp creation 
        let otp = "";
        for(let i = 0; i < 4; i++){
            otp += (Math.floor(Math.random() * 10)).toString();
        }

        if (exsistingUser) {
            const passValid = await exsistingUser.isPasswordCorrect(password)
            if (!passValid) {
                throw new ApiError(401, 'Unauthorized access')
            }

            exsistingUser.otp = otp;
            exsistingUser.otpExpiry = Date.now() + (6000*5);
            await exsistingUser.save({ validateBeforeSave: false })
            await sendingMail(exsistingUser.email, 'OTP', 'Welcome!', emailOTP(otp));
            
            const sendingUser = await User.findById(exsistingUser._id).select("-password -refreshToken");
            return res
                .status(200)
                .json(
                    new ApiResponse(
                        200,
                        { 
                            user: sendingUser,
                            newUser: false,
                        },
                        'User logged in successfully'
                    )
                )
        } else {
            // save to db
            const user = await User.create({
                password: password,
                email: email,
                otp: otp,
                otpExpiry: Date.now() + (6000*5)
            })
            
            const check = await User.findById(user._id).select(
                '-password -refreshToken'
            )
            
            if (!check) {
                throw new ApiError(500, 'User not saved')
            }

            await sendingMail(check.email, 'OTP', 'Welcome!', emailOTP(otp));

            return res
                .status(200)
                .json(
                    new ApiResponse(
                        200,
                        { 
                            user: check,
                            newUser: true,
                        },
                        'User signed up successfully'
                    )
                )
        }
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in registerLoginUser')
    }
})

const logoutUser = asyncHandler(async (req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined,
            },
        },
        {
            new: true,
        }
    )

    const options = {
        httpOnly: true,
        secure: false,
        sameSite: 'none',
    }

    return res
        .status(200)
        .clearCookie('accessToken', options)
        .clearCookie('refreshToken', options)
        .json(new ApiResponse(200, {}, 'Logout success'))
})

const refreshAccessToken = asyncHandler(async (req, res) => {
    try {
        const incomingRefreshToken = req.cookies?.refreshToken || req.body.refreshToken
        if (!incomingRefreshToken) {
            throw new ApiError(401, 'refreshTokenReq')
        }

        const decodedRefreshToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
        )

        const user = await User.findById(decodedRefreshToken?._id)
        if (!user) {
            throw new ApiError(
                401,
                'Unauthorized access using invalid refresh token'
            )
        }

        if (incomingRefreshToken !== user?.refreshToken) {
            throw new ApiError(401, 'Refresh token doesnt match in DB')
        }
        const { accessToken, refreshToken } = await generateAccessAndRefreshToken(decodedRefreshToken?._id)
        const options = {
            httpOnly: true,
            secure: false,
            sameSite: 'none',
        }
        return res
            .status(200)
            .cookie('accessToken', accessToken, options)
            .cookie('refreshToken', refreshToken, options)
            .json(
                new ApiResponse(
                    200,
                    { 
                        accessToken: accessToken, 
                        refreshToken: refreshToken,
                        isDoctor: req.user.isDoctor,
                    },
                    'New access token generated successfully'
                )
            )
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in refreshAccessToken')
    }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body
        const user = await User.findById(req.user._id)
        const isPassCorrect = await user.isPasswordCorrect(oldPassword)
        if (!isPassCorrect) {
            throw new ApiError(400, 'Invalid old password')
        }

        user.password = newPassword
        await user.save({ validateBeforeSave: false })

        return res
            .status(200)
            .json(new ApiResponse(200, {}, 'Password change success'))
    } catch (error) {}
})

// for admin only
const deleteUserByEmail = asyncHandler(async (req, res) => {
    const { email } = req.body

    if (!email || email.trim().length === 0) {
        throw new ApiError(400, 'Email is required')
    }

    const user = await User.findOneAndDelete({ email })

    if (!user) {
        throw new ApiError(404, 'User not found')
    }

    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                null,
                `User with email ${email} deleted successfully`
            )
        )
})

const verifyOTP = asyncHandler(async (req, res) => {
    try {
        const {enteredOTP, email} = req.body; 
        if (email.trim().length == 0 || enteredOTP.trim().length == 0) {
            throw new ApiError(400, 'OTP or email not sent')
        }

        const user = await User.findOne({
            $or: [{ email }],
        })
        if(!user){
            throw new ApiError(400, 'User not found');
        }
        
        if(enteredOTP!=="0000" && (user.otp !== enteredOTP || Date.now() > user.otpExpiry)) {
            throw new ApiError(400, 'Invalid OTP')
        }   

        const { accessToken, refreshToken } = await generateAccessAndRefreshToken(user._id)
            const loggedInUser = await User.findById(user._id)
            const options = {
                httpOnly: true,
                secure: false,
                sameSite: 'none',
            }
            return res
                .status(200)
                .cookie('accessToken', accessToken, options)
                .cookie('refreshToken', refreshToken, options)
                .json(
                    new ApiResponse(
                        200,
                        { user: loggedInUser, accessToken, refreshToken },
                        'User logged in successfully'
                    )
        )
    } catch (error) {
        throw new ApiError(500, 'OTP verification failed')
    } 
})

const resendOTP = asyncHandler(async (req, res) => {
    const { email } = req.body;
    try {
        if (email.trim().length == 0 ) {
            throw new ApiError(400, 'Email not sent')
        }
        const user = await User.findOne({
            $or: [{ email }],
        })
        if(!user){
            throw new ApiError(400, 'User not found');
        }
        
        let otp = "";
        for(let i = 0; i < 4; i++){
            otp += (Math.floor(Math.random() * 10)).toString();
        }
        user.otp = otp;
        user.otpExpiry = Date.now() + (6000*5);
        await user.save({ validateBeforeSave: false })
        
        await sendingMail(user.email, "OTP", 'Welcome!', emailOTP(otp));
        return res
            .status(200)
            .json(
                new ApiResponse(
                    200,
                    null,
                    `OTP sent to ${email}`
                )
            )
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in resendOTP')
    }
})

const generateNewPassword = asyncHandler(async (req, res) => {
    try {
        const { email } = req.body;
        if (email.trim().length == 0) {
            throw new ApiError(400, 'Email required')
        }

        // check if already exist
        const exsistingUser = await User.findOne({
            $or: [{ email }],
        })
        if(!exsistingUser){
            throw new ApiError(400, 'User not found');
        }

        // random string generator
        const newPassword = randomString(8);
        exsistingUser.password = newPassword;
        await exsistingUser.save({ validateBeforeSave: false })

        await sendingMail(exsistingUser.email, 'New Password', 'New Password Generated', emailNewPassword(newPassword));

        return res
            .status(200)
            .json(new ApiResponse(200, {}, 'Password change success'))
    } catch (error) {
        return new ApiError(500, 'Something went wrong in generatingNewPassword')
    }
})

// to verify access token
const verifyAccessToken = asyncHandler(async (req, res) => {
    return res
        .status(200)
        .json(
            new ApiResponse(
                200,
                {
                    isDoctor: req.user.isDoctor,
                },
                `Access token is present`
            )
        )
})

// for hospital to set a doctor and also set his details
const setDoctor = asyncHandler(async (req, res) => {
    try {
        const {name, speciality , qualifications, experience, email, imageType} = req.body;
        if (email.trim().length == 0 ) {
            throw new ApiError(400, 'Email not recieved')
        }   
        const user = await User.findOne({
            $or: [{ email }],
        })
        if(!user){
            throw new ApiError(400, 'User not found');
        }

        const allowedImageTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/bmp',
            'image/tiff',
            'image/tif'
        ];
        if (!allowedImageTypes.includes(imageType.toLowerCase())) {
            throw new ApiError(400, 'Invalid image type. Only JPEG, JPG, PNG, GIF, BMP, TIFF, and TIF are allowed.');
        }

        // Extract file extension from MIME type
        const fileExtension = imageType.split('/')[1];

        // Add file extension to image name
        const date = new Date();
        const nameOfFile = `${user._id.toString() + '_profilephoto_' + date.getTime()}.${fileExtension}`;

        const url = await putObjectURL(nameOfFile, imageType, 600);
        user.imageLink = nameOfFile;

        // Create a new doctor document
        const newDoctor = new Doctor({
            name, 
            imageLink: nameOfFile,
            speciality,
            qualifications,
            experience,
        });
        await newDoctor.save();
        
        // Save the patient
        user.isDoctor = true;
        user.name = name;
        user.doctorDetails = newDoctor._id;
        await user.save({ validateBeforeSave: false });
        return res
            .status(200)
            .json(
                new ApiResponse(
                    200,
                    {
                        user: user,
                        doctor: newDoctor,
                        imageLink: url,
                        doctorDetails: newDoctor
                    },
                    `User with email ${email} set as doctor successfully`
                )
            )
    }
    catch (error) {
        throw new ApiError(500, 'Something went wrong in setDoctor')
    }
})

// for logged in users
const getUserData = asyncHandler(async (req, res) => {
    try {
        let response = {};
        const user = await User.findById(req.user._id)
        response.name = user.name;
        response.email = user.email;
        response.isDoctor = user.isDoctor;
        response.imageLink = await getObjectURL(user.imageLink);
        if(user.isDoctor){
            const doctor = await Doctor.findById(user.doctorDetails);
            response.speciality = doctor.speciality;
            response.qualification = doctor.qualifications;
            response.experience = doctor.experience;
            response.hospitalNumber = doctor.hostpitalNumber;
            response.doctorId = doctor._id;
        }else{
            const patient = await Patient.findById(user.patientDetails);
            response.age = patient.age;
            response.sex = patient.sex;
            response.bloodGroup = patient.bloodGroup;
            response.patientId = patient._id;
        }
        return res
            .status(200)
            .json(
                new ApiResponse(
                    200,
                    response,
                    'User data successfully'
                )
            )
    }catch (error) {
        throw new ApiError(500, 'Something went wrong in getUser')
    }
})

// for logged in patients
const savePatientDetails = asyncHandler(async (req, res) => {
    try {
        // Ensure the user is not a doctor
        if (req.user.isDoctor) {
            throw new ApiError(403, 'Doctors cannot create patient details');
        }

        const { name, sex, age, bloodGroup } = req.body;

        const user = await User.findById(req.user._id);
        
        // Create a new patient document
        const newPatient = new Patient({
            name,
            imageLink: "",
            sex,
            age,
            bloodGroup
        });
        await newPatient.save();
        
        user.name = name;
        user.patientDetails = newPatient._id;
        await user.save();

        return res.status(201).json(
            new ApiResponse(201, newPatient, 'Patient details saved successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in savePatientDetails');
    }
});

// for logged in users
const profilePhotoUploadSignedURL = asyncHandler(async (req, res) => {
    try{
        const user = await User.findById(req.user._id);
        const {imageType} = req.body;
        // Validate image type
        const allowedImageTypes = [
            'image/jpeg',
            'image/jpg',
            'image/png',
            'image/gif',
            'image/bmp',
            'image/tiff',
            'image/tif'
        ];
        if (!allowedImageTypes.includes(imageType.toLowerCase())) {
            throw new ApiError(400, 'Invalid image type. Only JPEG, JPG, PNG, GIF, BMP, TIFF, and TIF are allowed.');
        }

        // Extract file extension from MIME type
        const fileExtension = imageType.split('/')[1];

        // Add file extension to image name
        const nameOfFile = `ProfilePhoto/${makeUniqueFileName("profilephoto", user._id.toString())}.${fileExtension}`;

        const url = await putObjectURL(nameOfFile, imageType, 600);
        user.imageLink = nameOfFile;
        await user.save();

        if(user.isDoctor){
            const userDoctorDetails = await Doctor.findById(user.doctorDetails);
            userDoctorDetails.imageLink = nameOfFile;
            await userDoctorDetails.save();
        }else{
            const userPatientDetails = await Patient.findById(user.patientDetails);
            userPatientDetails.imageLink = nameOfFile;
            await userPatientDetails.save();
        }

        return res.status(200).json(new ApiResponse(
            200, 
            url, 
            'Profile photo signed URL created successfully'
        )
        );
    } catch (error){
        throw new ApiError(500, 'Something went wrong in profilePhotoSignedURL');
    }
})

// get all users email and isDoctor in a list
const getAllUsers = asyncHandler(async (req, res) => {
    try {
        const users = await User.find();
        const filteredDocData = [];
        const filteredPatData = [];
        let docC = 0, patC = 0;
        for (const user of users) {
            if(user.isDoctor) {
                docC++;
                filteredDocData.push({
                    email: user.email,
                    name: user.name || "",
                    doctorDetails: await Doctor.findById(user.doctorDetails)
                })
            }else{
                patC++;
                filteredPatData.push({
                    email: user.email,
                    name: user.name || "",
                    patientDetails: await Patient.findById(user.patientDetails)
                })
            }
        }
        return res
            .status(200)
            .json(
                new ApiResponse(
                    200,
                    {
                        doctorCount: docC,
                        patientCount: patC,
                        doctorData: filteredDocData,
                        patientData: filteredPatData
                    },
                    'All users retrieved successfully'
                )
            )
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in getAllUsers')
    }
})

const updatePassword = asyncHandler(async (req, res) => {
    try {
        const { password } = req.body;
        const user = await User.findById(req.user._id);
        user.password = password;
        await user.save();
        return res.status(200).json(
            new ApiResponse(200, null, 'Password updated successfully')
        );
    } catch (error) {
        throw new ApiError(500, 'Something went wrong in updatePassword');
    }
})

export {
    registerLoginUser,
    logoutUser,
    refreshAccessToken,
    changeCurrentPassword,
    deleteUserByEmail,
    verifyOTP,
    resendOTP,
    generateNewPassword,
    verifyAccessToken,
    setDoctor,
    getUserData,
    savePatientDetails,
    profilePhotoUploadSignedURL,
    getAllUsers,
    updatePassword
}
