import mongoose from 'mongoose'

const doctorSchema = new mongoose.Schema({
    name: {
        type: String,
        trim: true
    },
    imageLink: {
        type: String,
    },
    speciality: {
        type: String,   
        trim: true
    },
    qualifications: {
        type: String,
        required: true,
    },
    experience: {
        type: String,
        required: true,
    },
    patientsList: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Patient',
        }
    ],
    hostpitalNumber: {
        type: String,
    }
}, {timestamps:true})

export const Doctor = mongoose.model('Doctor', doctorSchema)
